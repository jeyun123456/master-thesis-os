plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Deployment-specific values come from ~/.gradle/gradle.properties or -P flags, never from the repository.
fun prop(name: String) = providers.gradleProperty(name).orNull?.trim().orEmpty()

val baseUrl = prop("chocomint.baseUrl").trimEnd('/')
val googleWebClientId = prop("chocomint.googleWebClientId")
val keystorePath = prop("chocomint.keystore")

android {
    namespace = "com.masterthesisos.companion"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.masterthesisos.companion"
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "BASE_URL", "\"$baseUrl\"")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")
    }

    signingConfigs {
        if (keystorePath.isNotEmpty()) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = prop("chocomint.keystorePassword")
                keyAlias = prop("chocomint.keyAlias")
                keyPassword = prop("chocomint.keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }



    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
// A release APK must never ship without a real HTTPS origin, a Google client id and a signing key.
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst {
        check(baseUrl.startsWith("https://")) { "Set -Pchocomint.baseUrl=https://<your-host> for release builds." }
        check(googleWebClientId.isNotEmpty()) { "Set -Pchocomint.googleWebClientId for release builds." }
        check(keystorePath.isNotEmpty()) { "Set -Pchocomint.keystore (+ Password/keyAlias/keyPassword) so the release APK is signed." }
    }
}

dependencies {
    implementation("androidx.glance:glance-appwidget:1.2.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
