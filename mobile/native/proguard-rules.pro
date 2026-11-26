# Keep Capacitor & ChipNativePlugin reflection methods
-keep class tw.chipscreener.mobile.ChipNativePlugin { *; }
-keep class tw.chipscreener.mobile.MainActivity { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
}
