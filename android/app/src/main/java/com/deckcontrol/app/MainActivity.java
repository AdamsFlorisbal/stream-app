package com.deckcontrol.app;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.List;

/**
 * Tela unica do aplicativo.
 *
 * O deck em si e' a interface web servida pelo PC — o aplicativo nativo cuida
 * do que a web nao alcanca: descobrir o servidor na rede, manter a tela ligada,
 * entrar em modo imersivo e reconectar sozinho quando o cabo ou o Wi-Fi voltam.
 */
public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private View splash;
    private TextView splashStatus;
    private ConnectionStore store;
    private ServerLocator locator;
    private String baseUrl;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        store = new ConnectionStore(this);
        locator = new ServerLocator(store);

        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        if (store.isKeepAwake()) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#05070d"));

        webView = buildWebView();
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        splash = buildSplash();
        root.addView(splash, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        setContentView(root);
        applyImmersiveMode();

        // O botao Voltar navega dentro do deck; so' sai do app na primeira tela.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else finish();
            }
        });

        discoverAndLoad();
    }

    private WebView buildWebView() {
        WebView view = new WebView(this);
        WebSettings settings = view.getSettings();

        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // A interface ja e' responsiva; deixar o WebView "ajustar" atrapalharia.
        settings.setUseWideViewPort(false);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setTextZoom(100);

        view.setBackgroundColor(Color.parseColor("#05070d"));
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);

        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView webView, String url) {
                hideSplash();
            }

            @Override
            public void onReceivedError(WebView webView, WebResourceRequest request, WebResourceError error) {
                // Erros de sub-recurso nao devem derrubar a tela inteira.
                if (request != null && request.isForMainFrame()) {
                    showSplash("Conexao perdida. Procurando o servidor…");
                    webView.postDelayed(MainActivity.this::discoverAndLoad, 2500);
                }
            }
        });

        return view;
    }

    private View buildSplash() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(android.view.Gravity.CENTER);
        layout.setBackgroundColor(Color.parseColor("#05070d"));
        layout.setPadding(48, 48, 48, 48);

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextColor(Color.parseColor("#e8eef7"));
        title.setTextSize(26);
        title.setGravity(android.view.Gravity.CENTER);

        ProgressBar spinner = new ProgressBar(this);
        spinner.setIndeterminate(true);
        LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        spinnerParams.topMargin = 28;
        spinnerParams.bottomMargin = 18;

        splashStatus = new TextView(this);
        splashStatus.setText(R.string.searching);
        splashStatus.setTextColor(Color.parseColor("#78849a"));
        splashStatus.setTextSize(14);
        splashStatus.setGravity(android.view.Gravity.CENTER);

        layout.addView(title);
        layout.addView(spinner, spinnerParams);
        layout.addView(splashStatus);

        // Toque na tela de espera abre a entrada manual de endereco.
        layout.setOnClickListener(v -> promptForAddress(null));
        return layout;
    }

    private void discoverAndLoad() {
        showSplash(getString(R.string.searching));
        locator.locate(new ServerLocator.Callback() {
            @Override
            public void onFound(String url, String transport) {
                baseUrl = url;
                store.setBaseUrl(url);
                splashStatus.setText(getString(R.string.connected_via,
                        "usb".equals(transport) ? getString(R.string.transport_usb) : getString(R.string.transport_wifi)));
                webView.loadUrl(url + "/");
            }

            @Override
            public void onNotFound(List<String> tried) {
                promptForAddress(tried);
            }
        });
    }

    private void promptForAddress(List<String> tried) {
        EditText input = new EditText(this);
        input.setHint("192.168.1.10:8787");
        String saved = store.getBaseUrl();
        if (saved != null && !saved.isEmpty()) {
            input.setText(saved.replace("http://", ""));
        }

        StringBuilder message = new StringBuilder(getString(R.string.not_found_message));
        if (tried != null && !tried.isEmpty()) {
            message.append("\n\n").append(getString(R.string.tried)).append("\n");
            for (String candidate : tried) message.append("• ").append(candidate).append("\n");
        }

        new AlertDialog.Builder(this)
                .setTitle(R.string.not_found_title)
                .setMessage(message.toString())
                .setView(input)
                .setPositiveButton(R.string.connect, (dialog, which) -> {
                    String typed = ServerLocator.normalize(input.getText().toString());
                    if (typed.isEmpty()) {
                        promptForAddress(tried);
                        return;
                    }
                    showSplash(getString(R.string.checking, typed));
                    locator.check(typed, new ServerLocator.Callback() {
                        @Override
                        public void onFound(String url, String transport) {
                            baseUrl = url;
                            store.setBaseUrl(url);
                            webView.loadUrl(url + "/");
                        }

                        @Override
                        public void onNotFound(List<String> attempted) {
                            Toast.makeText(MainActivity.this, R.string.no_answer, Toast.LENGTH_LONG).show();
                            promptForAddress(attempted);
                        }
                    });
                })
                .setNegativeButton(R.string.retry, (dialog, which) -> discoverAndLoad())
                .setCancelable(false)
                .show();
    }

    private void showSplash(String status) {
        splash.setVisibility(View.VISIBLE);
        if (splashStatus != null) splashStatus.setText(status);
    }

    private void hideSplash() {
        splash.setVisibility(View.GONE);
    }

    /** Esconde barras de status e navegacao — o deck ocupa a tela inteira. */
    private void applyImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersiveMode();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // O tablet pode ter trocado de rede enquanto estava em segundo plano.
        if (baseUrl != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        locator.shutdown();
        webView.destroy();
        super.onDestroy();
    }
}
