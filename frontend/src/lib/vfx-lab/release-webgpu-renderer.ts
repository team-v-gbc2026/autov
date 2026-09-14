import type { WebGPURenderer } from "three/webgpu";

/** Detach presentation while its queue is still alive, then release the device.
 * Firefox's Linux shared-texture cleanup may otherwise resolve an already
 * dropped QueueId when the canvas swap chain is finally released.
 */
export async function releaseWebGPURenderer(renderer: WebGPURenderer): Promise<void> {
  renderer.setAnimationLoop(null);
  const backend = renderer.backend as unknown as {
    isWebGPUBackend?: boolean;
    device?: GPUDevice;
  };
  if (backend.isWebGPUBackend && backend.device) {
    // Read the canvas directly: backend.context lazily configures it, which is
    // the opposite of what teardown needs. Retain the queue through the fence.
    const queue = backend.device.queue;
    const context = renderer.domElement.getContext("webgpu") as GPUCanvasContext | null;
    context?.unconfigure();
    try {
      // Also places a queue round trip after unconfigure, before Three destroys
      // the device. An already-lost device rejects; it still needs disposal.
      await queue.onSubmittedWorkDone();
    } catch {
      // Device loss during cleanup is expected and must not prevent release.
    }
  }
  await renderer.dispose();
}
