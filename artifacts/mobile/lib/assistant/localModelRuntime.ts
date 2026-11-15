export interface LocalModelManifest {
  id: string;
  version: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  format: "gguf" | "onnx";
}

export interface InstalledLocalModel {
  manifest: LocalModelManifest;
  localPath: string;
}

export interface LocalModelStorage {
  download(url: string, destinationId: string, maxBytes: number): Promise<{ localPath: string; sizeBytes: number }>;
  remove(localPath: string): Promise<void>;
}

export interface LocalInferenceRuntime {
  load(modelPath: string, format: LocalModelManifest["format"]): Promise<void>;
  generate(prompt: string, options: { maxTokens: number }): Promise<string>;
  unload(): Promise<void>;
}

export type LocalModelState =
  | { status: "unavailable"; reason: string }
  | { status: "not_installed" }
  | { status: "installed"; model: InstalledLocalModel }
  | { status: "ready"; model: InstalledLocalModel };

export interface LocalModelManagerOptions {
  storage: LocalModelStorage;
  runtime?: LocalInferenceRuntime;
  digestSha256: (localPath: string) => Promise<string>;
  maxModelBytes?: number;
}

/** Model lifecycle boundary for a native on-device inference adapter.
 * No network/cloud inference fallback is hidden in this class.
 */
export function createLocalModelManager(options: LocalModelManagerOptions) {
  const maxModelBytes = Math.max(1, Math.min(2_000_000_000, options.maxModelBytes ?? 1_000_000_000));
  let installed: InstalledLocalModel | null = null;
  let loaded = false;

  function validateManifest(manifest: LocalModelManifest): void {
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/iu.test(manifest.id) ||
        !/^[0-9A-Za-z._+-]{1,40}$/u.test(manifest.version) ||
        !/^https:\/\//u.test(manifest.url) ||
        !/^[a-f0-9]{64}$/iu.test(manifest.sha256) ||
        !Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes < 1 ||
        manifest.sizeBytes > maxModelBytes ||
        (manifest.format !== "gguf" && manifest.format !== "onnx")) {
      throw new Error("LOCAL_MODEL_MANIFEST_INVALID");
    }
  }

  return {
    getState(): LocalModelState {
      if (!options.runtime) return { status: "unavailable", reason: "A compatible native local inference runtime is not registered on this device." };
      if (!installed) return { status: "not_installed" };
      return loaded ? { status: "ready", model: installed } : { status: "installed", model: installed };
    },

    async install(manifest: LocalModelManifest): Promise<InstalledLocalModel> {
      validateManifest(manifest);
      if (!options.runtime) throw new Error("LOCAL_INFERENCE_RUNTIME_UNAVAILABLE");
      if (loaded) await options.runtime.unload();
      loaded = false;
      const downloaded = await options.storage.download(manifest.url, manifest.id, maxModelBytes);
      if (downloaded.sizeBytes !== manifest.sizeBytes || downloaded.sizeBytes > maxModelBytes) {
        await options.storage.remove(downloaded.localPath).catch(() => undefined);
        throw new Error("LOCAL_MODEL_SIZE_MISMATCH");
      }
      const actualDigest = (await options.digestSha256(downloaded.localPath)).toLowerCase();
      if (actualDigest !== manifest.sha256.toLowerCase()) {
        await options.storage.remove(downloaded.localPath).catch(() => undefined);
        throw new Error("LOCAL_MODEL_CHECKSUM_MISMATCH");
      }
      installed = { manifest: { ...manifest }, localPath: downloaded.localPath };
      return installed;
    },

    async load(): Promise<void> {
      if (!options.runtime) throw new Error("LOCAL_INFERENCE_RUNTIME_UNAVAILABLE");
      if (!installed) throw new Error("LOCAL_MODEL_NOT_INSTALLED");
      await options.runtime.load(installed.localPath, installed.manifest.format);
      loaded = true;
    },

    async generate(prompt: string, maxTokens = 256): Promise<string> {
      if (!options.runtime || !loaded) throw new Error("LOCAL_MODEL_NOT_READY");
      if (!prompt.trim() || prompt.length > 12_000) throw new Error("LOCAL_PROMPT_INVALID");
      const boundedTokens = Math.max(1, Math.min(1024, Math.floor(maxTokens)));
      const output = await options.runtime.generate(prompt, { maxTokens: boundedTokens });
      if (typeof output !== "string") throw new Error("LOCAL_MODEL_OUTPUT_INVALID");
      return output.slice(0, 24_000);
    },

    async uninstall(): Promise<void> {
      if (loaded && options.runtime) await options.runtime.unload();
      loaded = false;
      if (installed) await options.storage.remove(installed.localPath);
      installed = null;
    },
  };
}
