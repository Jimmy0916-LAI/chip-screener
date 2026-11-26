package tw.chipscreener.mobile;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ChipNativePlugin.class);
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null) {
            int bg = Color.parseColor("#0b0e14");
            window.setStatusBarColor(bg);
            window.setNavigationBarColor(bg);
        }
    }
}
