import org.jetbrains.compose.desktop.application.dsl.TargetFormat
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
import org.jetbrains.kotlin.gradle.targets.js.webpack.KotlinWebpackConfig

/**
 * Shared sample UI + non-Android entry points.
 *
 * Split out of `:sample-app` for AGP 9: since AGP 9.0 the `com.android.application` plugin refuses
 * to coexist with `org.jetbrains.kotlin.multiplatform`, and there is no
 * `com.android.kotlin.multiplatform.application` to move an app module to. So the multiplatform half
 * lives here (as a LIBRARY, which does have a KMP-compatible plugin) and `:sample-app` is reduced to
 * a plain Android application that depends on it.
 *
 * That keeps every demo platform — android, desktop, iOS, wasmJs — while letting the build drop the
 * `android.builtInKotlin=false` / `android.newDsl=false` escape hatches entirely.
 */
plugins {
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    androidLibrary {
        namespace = "com.mobilebytelabs.paycraft.sample.shared"
        compileSdk =
            libs.versions.android.compileSdk
                .get()
                .toInt()
        minSdk =
            libs.versions.android.minSdk
                .get()
                .toInt()
    }

    jvm("desktop")

    // iosX64 intentionally absent — :cmp-paycraft dropped it (Compose MP publishes no iosX64
    // variant since 1.11), so depending on it here could not resolve.
    listOf(
        iosArm64(),
        iosSimulatorArm64(),
    ).forEach { iosTarget ->
        iosTarget.binaries.framework {
            baseName = "SampleShared"
            isStatic = true
        }
    }

    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        outputModuleName = "sampleApp"
        browser {
            val rootDirPath = project.rootDir.path
            val projectDirPath = project.projectDir.path
            commonWebpackConfig {
                outputFileName = "sampleApp.js"
                devServer =
                    (devServer ?: KotlinWebpackConfig.DevServer()).apply {
                        static =
                            (static ?: mutableListOf()).apply {
                                add(rootDirPath)
                                add(projectDirPath)
                            }
                    }
            }
        }
        binaries.executable()
    }

    sourceSets {
        val desktopMain by getting

        commonMain.dependencies {
            // `api`, not `implementation`: :sample-app's MainActivity composes shared UI and
            // needs Compose on its own classpath. Exposing it from here keeps ONE Compose version
            // (whatever Compose MP resolves) instead of pinning androidx.compose separately in the
            // app module and risking a skew between the two.
            api(compose.runtime)
            api(compose.foundation)
            api(compose.material3)
            api(compose.ui)
            implementation(compose.components.resources)
            implementation(compose.components.uiToolingPreview)

            // The library under demonstration. `api` (not `implementation`) so :sample-app can
            // reach PayCraft's own types — its MainActivity/Application talk to PayCraft directly.
            api(project(":cmp-paycraft"))

            // Koin (not transitive from cmp-paycraft)
            api(libs.koin.core)
            implementation(libs.koin.compose)
        }

        desktopMain.dependencies {
            implementation(compose.desktop.currentOs)
        }
    }
}

compose.desktop {
    application {
        mainClass = "com.mobilebytelabs.paycraft.sample.MainKt"

        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "com.mobilebytelabs.paycraft.sample"
            packageVersion = "1.0.0"
        }
    }
}
