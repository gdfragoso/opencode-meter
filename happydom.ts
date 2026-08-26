// Registers a DOM on globalThis so component tests can render. Preloaded by
// bun test via bunfig.toml.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:9393" });
