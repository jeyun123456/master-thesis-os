plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.masterthesisos.companion"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.masterthesisos.companion"
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-poc"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation("androidx.glance:glance-appwidget:1.2.0")
}
