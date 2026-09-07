# Gerando e instalando o APK

O aplicativo web já funciona no navegador do tablet e pode ser instalado pela
opção *Adicionar à tela inicial*. O APK acrescenta o que a web não alcança:

- **descoberta automática** do PC por sondagem UDP na rede local;
- **detecção do cabo USB** — testa `127.0.0.1` antes de tudo;
- **tela sempre ligada** durante a transmissão;
- **modo imersivo** de verdade, sem barras do sistema;
- **reconexão automática** quando o cabo ou o Wi-Fi voltam.

---

## Caminho A — compilar na nuvem (sem instalar nada)

Este é o caminho recomendado: não exige Android Studio nem o SDK na sua
máquina.

1. Publique este projeto em um repositório do GitHub.

2. Vá em **Actions** → **Gerar APK** → **Run workflow**.

3. Ao terminar (≈4 minutos), baixe o artefato **`deck-control-apk`**.
   Dentro dele está o `app-debug.apk`.

O fluxo está em [`.github/workflows/android.yml`](../.github/workflows/android.yml).
Ele instala o JDK 17, o Android SDK e o Gradle 8.9, e compila os dois APKs
(debug e release).

> O APK de *debug* já vem assinado com a chave de depuração padrão, então
> instala direto. O de *release* sai sem assinatura e só serve se você for
> assiná-lo com uma chave própria.

---

## Caminho B — compilar no seu PC

**Requisitos:** JDK 17 e o Android SDK (o Android Studio traz os dois).

```powershell
cd android
gradle assembleDebug          # ou .\gradlew assembleDebug se gerar o wrapper
```

O APK sai em:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Se preferir usar o wrapper do Gradle (recomendado para builds repetíveis):

```powershell
cd android
gradle wrapper --gradle-version 8.9
.\gradlew assembleDebug
```

---

## Instalando no tablet

### Pelo cabo (com adb)

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

### Sem cabo

1. Copie o `.apk` para o tablet (Google Drive, e-mail, cabo como pen drive).
2. Abra o arquivo no tablet.
3. O Android vai pedir permissão para **instalar apps de fontes desconhecidas**
   para o aplicativo que abriu o arquivo — autorize.

---

## Primeira abertura

O aplicativo procura o servidor sozinho, nesta ordem:

1. **`127.0.0.1:8787`** — responde quando o `adb reverse` está ativo (cabo USB)
2. **Último endereço usado** — reconecta na hora ao voltar para a mesma rede
3. **Sondagem UDP em broadcast** na porta 8788 — encontra o PC em qualquer rede

Cada candidato é confirmado com uma chamada a `/api/health`, que precisa
responder `service: "deck-control"` — assim o aplicativo nunca tenta carregar
outro servidor que por acaso esteja na mesma porta.

Se nada responder, ele abre uma caixa para digitar o endereço, listando o que
já foi tentado. Aceita `192.168.1.10`, `192.168.1.10:8787` ou a URL completa.

---

## Personalizar o aplicativo

| O quê | Onde |
|---|---|
| Nome exibido | `android/app/src/main/res/values/strings.xml` |
| Ícone | `android/app/src/main/res/drawable/ic_launcher_*.xml` |
| Cores | `android/app/src/main/res/values/colors.xml` |
| Porta padrão | `ServerLocator.DEFAULT_HTTP_PORT` |
| Orientação | `android:screenOrientation` no `AndroidManifest.xml` |

A interface em si — teclas, knobs, telemetria — vem do servidor, não do APK.
Mudanças no visual aparecem no tablet ao recarregar, **sem recompilar nada**.
