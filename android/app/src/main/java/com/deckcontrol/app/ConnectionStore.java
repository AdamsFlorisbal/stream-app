package com.deckcontrol.app;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Guarda o ultimo servidor usado, para que a reabertura do aplicativo reconecte
 * sem nenhuma interacao.
 */
public final class ConnectionStore {

    private static final String FILE = "deck-control";
    private static final String KEY_BASE_URL = "baseUrl";
    private static final String KEY_KEEP_AWAKE = "keepAwake";

    private final SharedPreferences preferences;

    public ConnectionStore(Context context) {
        this.preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public String getBaseUrl() {
        return preferences.getString(KEY_BASE_URL, "");
    }

    public void setBaseUrl(String baseUrl) {
        preferences.edit().putString(KEY_BASE_URL, baseUrl).apply();
    }

    public boolean isKeepAwake() {
        return preferences.getBoolean(KEY_KEEP_AWAKE, true);
    }

    public void setKeepAwake(boolean keepAwake) {
        preferences.edit().putBoolean(KEY_KEEP_AWAKE, keepAwake).apply();
    }

    public void clear() {
        preferences.edit().remove(KEY_BASE_URL).apply();
    }
}
