package com.safesmartpickup.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Sin esto, el WebView hereda el tamaño de fuente de accesibilidad
        // del sistema Android y agranda todo el texto (y lo que depende de
        // su métrica, como el padding en rem/em de Tailwind) mucho más que
        // el mismo sitio en Chrome, que no aplica ese mismo escalado — eso
        // es lo que hacía que la campanita y el botón de salir quedaran
        // cortados fuera de pantalla en la app pero no en el navegador.
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
