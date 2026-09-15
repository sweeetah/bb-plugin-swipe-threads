import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi) {
  bb.log.info("Visit history bar ready (threads + all screens, no swipe)");
}
