# Android builds from GitHub Actions

The repository now includes the **Android build** workflow at `.github/workflows/android-build.yml`.

## Trigger a build from a phone

1. Open the repository on GitHub.
2. Tap **Actions** → **Android build**.
3. Tap **Run workflow**.
4. Choose `debug` for an immediately installable debug APK, or `release` for a release build.
5. For a release build, set **Sign the release APK with Android repository secrets** to `true` only after the signing secrets below have been added.
6. Open the completed workflow run, select its artifact, and download the APK.

The workflow also runs automatically when files under `android/` or this workflow change on `main`.

## Release signing secrets

The workflow never stores a keystore in Git. Add these as **Repository secrets** under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded `.jks` or `.keystore` file contents |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias inside the keystore |
| `ANDROID_KEY_PASSWORD` | Password for the key alias |

For example, encode a keystore locally with:

```sh
base64 -w 0 my-release.keystore
```

Paste the resulting single-line value into `ANDROID_KEYSTORE_BASE64`. The workflow decodes the keystore only inside the ephemeral GitHub-hosted runner, signs the APK, verifies the signature, and removes the temporary signing files before uploading the artifact.

If release signing is not enabled, the workflow still produces an **unsigned release APK** for inspection. A debug build does not require signing secrets.

## Dependency note

The uploaded Android project is a generated Capacitor project and references native packages that were not present in the repository's existing Node manifest. The workflow installs the exact generated-project dependency versions at build time without changing the repository's `package.json` or lockfile.
