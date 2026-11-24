import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    `maven-publish`
}

android {
    namespace = "ai.osonai"
    compileSdk = 35
    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    publishing {
        singleVariant("release") { withSourcesJar() }
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    // api: tool handlers are suspend functions, so the app gets Dispatchers and withContext too.
    api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}

publishing {
    publications {
        register<MavenPublication>("release") {
            // JitPack sets GROUP and VERSION; a local publishToMavenLocal uses the defaults.
            groupId = System.getenv("GROUP") ?: "ai.osonai"
            artifactId = "osonai-android"
            version = System.getenv("VERSION") ?: "0.1.0"
            afterEvaluate { from(components["release"]) }
        }
    }
}
