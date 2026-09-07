package com.deckcontrol.app;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Encontra o servidor Deck Control sem que o usuario digite endereco.
 *
 * A busca segue tres caminhos, nesta ordem de preferencia:
 *   1. Loopback — quando o PC aplicou `adb reverse`, o servidor responde em
 *      127.0.0.1 pelo proprio cabo USB. E' o caminho mais rapido e estavel.
 *   2. Ultimo endereco usado — reconecta na hora ao voltar para a mesma rede.
 *   3. Sondagem UDP em broadcast — descobre o PC em qualquer rede local.
 */
public final class ServerLocator {

    /** Deve casar com DiscoveryBeacon.PROBE no servidor. */
    private static final String PROBE = "DECK-CONTROL-DISCOVER/1";
    private static final int DISCOVERY_PORT = 8788;
    private static final int DEFAULT_HTTP_PORT = 8787;
    private static final int PROBE_TIMEOUT_MS = 1400;
    private static final int HEALTH_TIMEOUT_MS = 900;

    /** Resultado da busca, entregue sempre na thread da interface. */
    public interface Callback {
        void onFound(String baseUrl, String transport);
        void onNotFound(List<String> tried);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ConnectionStore store;

    public ServerLocator(ConnectionStore store) {
        this.store = store;
    }

    /** Dispara a busca completa em segundo plano. */
    public void locate(Callback callback) {
        executor.execute(() -> {
            List<String> tried = new ArrayList<>();

            String usb = "http://127.0.0.1:" + DEFAULT_HTTP_PORT;
            tried.add(usb);
            if (isAlive(usb)) {
                main.post(() -> callback.onFound(usb, "usb"));
                return;
            }

            String saved = store.getBaseUrl();
            if (saved != null && !saved.isEmpty()) {
                tried.add(saved);
                if (isAlive(saved)) {
                    main.post(() -> callback.onFound(saved, "wifi"));
                    return;
                }
            }

            for (String candidate : broadcastProbe()) {
                tried.add(candidate);
                if (isAlive(candidate)) {
                    main.post(() -> callback.onFound(candidate, "wifi"));
                    return;
                }
            }

            main.post(() -> callback.onNotFound(tried));
        });
    }

    /** Verifica um endereco especifico — usado pela tela de entrada manual. */
    public void check(String baseUrl, Callback callback) {
        executor.execute(() -> {
            String normalized = normalize(baseUrl);
            if (isAlive(normalized)) {
                main.post(() -> callback.onFound(normalized, "wifi"));
            } else {
                List<String> tried = new ArrayList<>();
                tried.add(normalized);
                main.post(() -> callback.onNotFound(tried));
            }
        });
    }

    /** Aceita "192.168.1.5", "192.168.1.5:9000" ou a URL completa. */
    public static String normalize(String input) {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) return "";
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://" + value;
        }
        if (!value.matches("^https?://[^/]+:\\d+.*$")) {
            value = value.replaceAll("/+$", "") + ":" + DEFAULT_HTTP_PORT;
        }
        return value.replaceAll("/+$", "");
    }

    /**
     * Envia a sondagem em broadcast e coleta os anuncios que chegarem dentro da
     * janela de espera. Um mesmo PC pode responder com varios enderecos (cabo,
     * Wi-Fi, maquina virtual), entao todos entram na lista de tentativas.
     */
    private Set<String> broadcastProbe() {
        Set<String> candidates = new LinkedHashSet<>();
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setSoTimeout(PROBE_TIMEOUT_MS);

            byte[] payload = PROBE.getBytes(StandardCharsets.UTF_8);
            socket.send(new DatagramPacket(payload, payload.length,
                    InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT));

            long deadline = System.currentTimeMillis() + PROBE_TIMEOUT_MS;
            byte[] buffer = new byte[4096];

            while (System.currentTimeMillis() < deadline) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                } catch (IOException timeout) {
                    break;
                }
                collect(candidates, packet);
            }
        } catch (Exception ignored) {
            // Rede indisponivel: a lista simplesmente volta vazia.
        } finally {
            if (socket != null) socket.close();
        }
        return candidates;
    }

    private void collect(Set<String> candidates, DatagramPacket packet) {
        try {
            String text = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
            JSONObject json = new JSONObject(text);
            int port = json.optInt("httpPort", DEFAULT_HTTP_PORT);

            // O endereco de origem do pacote e' sempre alcancavel a partir daqui.
            candidates.add("http://" + packet.getAddress().getHostAddress() + ":" + port);

            JSONArray addresses = json.optJSONArray("addresses");
            if (addresses != null) {
                for (int i = 0; i < addresses.length(); i++) {
                    candidates.add("http://" + addresses.getString(i) + ":" + port);
                }
            }
        } catch (Exception ignored) {
            // Pacote de outro programa na mesma porta: descarta.
        }
    }

    /** Confirma que ha um Deck Control de verdade no endereco. */
    private boolean isAlive(String baseUrl) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(baseUrl + "/api/health").openConnection();
            connection.setConnectTimeout(HEALTH_TIMEOUT_MS);
            connection.setReadTimeout(HEALTH_TIMEOUT_MS);
            connection.setRequestMethod("GET");
            if (connection.getResponseCode() != 200) return false;

            java.io.InputStream stream = connection.getInputStream();
            byte[] data = new byte[512];
            int read = stream.read(data);
            stream.close();
            if (read <= 0) return false;

            JSONObject json = new JSONObject(new String(data, 0, read, StandardCharsets.UTF_8));
            return "deck-control".equals(json.optString("service"));
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    public void shutdown() {
        executor.shutdownNow();
    }
}
