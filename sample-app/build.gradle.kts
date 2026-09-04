/**
 * PayCraft sample — Android application.
 *
 * Plain `com.android.application`, deliberately WITHOUT the Kotlin Multiplatform plugin: since
 * AGP 9.0 the two refuse to coexist. Everything multiplatform (shared Compose UI, plus the desktop
 * / iOS / wasmJs entry points) lives in `:sample-shared`; this module holds only what is genuinely
 * Android — `SampleApplication`, `MainActivity`, the manifest, resources, and the instrumented
 * tests that need a device.
 *
 * Kotlin comes from AGP 9's built-in Kotlin support, so no `kotlin-android` plugin is applied.
 */
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.composeCompiler)
}

android {
    namespace = "com.mobilebytelabs.paycraft.sample"
    compileSdk =
        libs.versions.android.compileSdk
            .get()
            .toInt()

    defaultConfig {
        applicationId = "com.mobilebytelabs.paycraft.sample"
        minSdk =
            libs.versions.android.minSdk
                .get()
                .toInt()
        targetSdk =
            libs.versions.android.targetSdk
                .get()
                .toInt()
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    // Shared sample UI + the PayCraft library (exposed via `api` from :sample-shared).
    implementation(project(":sample-shared"))

    implementation(libs.androidx.activity.compose)
    implementation(libs.koin.android)

    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.koin.test)
    androidTestImplementation(libs.koin.test.junit4)
    androidTestImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.junit)
    debugImplementation(libs.compose.ui.test.manifest)
}
