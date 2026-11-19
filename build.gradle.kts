plugins {
    kotlin("multiplatform") version "2.0.21"
}

repositories {
    mavenCentral()
}

kotlin {
    js(IR) {
        moduleName = "shaman-engine"
        browser {
            commonWebpackConfig {
                outputFileName = "shaman-engine.js"
            }
        }
        binaries.executable()
    }
}
