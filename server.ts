import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi) {
  bb.log.info("Thread history bar ready (no swipe)");
}
