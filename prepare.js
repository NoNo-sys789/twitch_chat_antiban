import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";
import { sync as rimrafSync } from "rimraf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function prepareExtension() {
  // 1. Read version from manifest.json
  const manifestPath = path.join(__dirname, "src", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const { version } = manifest;

  // 2. Create temp folders (remove leftovers from a previous run)
  const tempChromePath = path.join(__dirname, "temp-chrome");
  const tempFirefoxPath = path.join(__dirname, "temp-firefox");
  rimrafSync(tempChromePath);
  rimrafSync(tempFirefoxPath);
  fs.mkdirSync(tempChromePath);
  fs.mkdirSync(tempFirefoxPath);
  copyFolderRecursiveSync(path.join(__dirname, "src"), tempChromePath);
  copyFolderRecursiveSync(path.join(__dirname, "src"), tempFirefoxPath);

  // 3. Combine manifest files in temp-firefox
  const firefoxManifestTemplate = JSON.parse(
    fs.readFileSync(
      path.join(tempFirefoxPath, "manifest.firefox.json"),
      "utf8",
    ),
  );
  const firefoxManifest = combineManifests(manifest, firefoxManifestTemplate);
  delete firefoxManifest.action;
  fs.writeFileSync(
    path.join(tempFirefoxPath, "manifest.json"),
    JSON.stringify(firefoxManifest, null, 2),
  );

  // 4. Delete manifest.firefox.json
  fs.unlinkSync(path.join(tempChromePath, "manifest.firefox.json"));
  fs.unlinkSync(path.join(tempFirefoxPath, "manifest.firefox.json"));

  // 5. Replace external API
  const apiUrl = process.env.APIURL;
  if (!apiUrl?.trim()) {
    console.error(
      "APIURL environment variable is required for building the extension.",
    );
    process.exit(1);
  }
  replaceTokens(tempChromePath, apiUrl);
  replaceTokens(tempFirefoxPath, apiUrl);

  // 6. Archive extensions
  archiveExtension(tempChromePath, `src-chrome-${version}.zip`, "src");
  archiveExtension(tempFirefoxPath, `src-firefox-${version}.zip`);
}

function combineManifests(target, source) {
  const output = { ...target };
  for (const [key, value] of Object.entries(source)) {
    output[key] = value;
  }
  return output;
}

function copyFolderRecursiveSync(srcPath, destPath) {
  const entries = fs.readdirSync(srcPath, { withFileTypes: true });
  fs.mkdirSync(destPath, { recursive: true });
  for (const entry of entries) {
    const src = path.join(srcPath, entry.name);
    const dest = path.join(destPath, entry.name);
    if (entry.isDirectory()) {
      copyFolderRecursiveSync(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function archiveExtension(dirPath, name, dir = false) {
  const zipPath = path.join(__dirname, name);
  const zip = archiver("zip", { zlib: { level: 9 } });
  const zipStream = fs.createWriteStream(zipPath);
  zip.pipe(zipStream);
  zip.directory(dirPath, dir);
  zip.finalize();
  zipStream.on("close", () => {
    console.log(`Created ${zipPath}`);
    rimrafSync(dirPath);
  });
}

function replaceTokens(dirPath, apiUrl) {
  const utilsFilePath = path.join(dirPath, "scripts", "utils.js");
  const utilsContent = fs.readFileSync(utilsFilePath, "utf8");
  const replacedContent = utilsContent.replaceAll("%APIURL%", apiUrl);
  fs.writeFileSync(utilsFilePath, replacedContent);
}

prepareExtension();
