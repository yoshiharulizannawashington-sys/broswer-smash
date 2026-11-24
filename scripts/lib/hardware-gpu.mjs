// Shared renderer guard for hardware-GPU acceptance.
//
// Default behavior is unchanged: a suite run without HARDWARE_GPU / IRON_MATRIX_GPU gets the
// SwiftShader launch used by the existing software evidence. A hardware run sets HARDWARE_GPU=1,
// which removes the SwiftShader flags, enables the GPU, and (by default) launches headed so the
// target display's real driver is used. HARDWARE_GPU_HEADLESS=1 is an explicit opt-in for a
// verified headless GPU host.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const HARDWARE_GPU = process.env.HARDWARE_GPU === '1' || process.env.IRON_MATRIX_GPU === '1';

export function browserLaunchOptions() {
  const headed = process.env.HARDWARE_GPU_HEADED === '1'
    || (HARDWARE_GPU && process.env.HARDWARE_GPU_HEADLESS !== '1');
  return {
    headless: !headed,
    args: HARDWARE_GPU
      ? ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu']
      : ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  };
}

// Read the renderer from the renderer the game actually created, not from a fresh probe canvas.
// WEBGL_debug_renderer_info is recorded when available, with the public VENDOR/RENDERER values as
// a fallback. The returned object is the unit of renderer evidence for a hardware run.
export async function captureGpu(page) {
  return page.evaluate(() => {
    const renderer = window.__browserSmashRenderer || null;
    const canvas = renderer?.domElement || document.querySelector('canvas');
    const gl = renderer?.getContext?.()
      || canvas?.getContext?.('webgl2')
      || canvas?.getContext?.('webgl');
    if (!gl) {
      return {
        available: false,
        capturedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        canvas: null
      };
    }
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const param = (name, fallback) => {
      const value = debug ? gl.getParameter(debug[name]) : null;
      return value ?? gl.getParameter(gl[fallback]);
    };
    return {
      available: true,
      vendor: param('UNMASKED_VENDOR_WEBGL', 'VENDOR'),
      renderer: param('UNMASKED_RENDERER_WEBGL', 'RENDERER'),
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      debugRendererInfo: Boolean(debug),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight
      } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent,
      capturedAt: new Date().toISOString()
    };
  });
}

export function isSoftwareRenderer(gpu) {
  const label = [gpu?.renderer, gpu?.unmaskedRenderer, gpu?.vendor, gpu?.unmaskedVendor]
    .filter(Boolean).join(' ');
  return /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(label);
}

export function assertHardwareGpu(gpu, source = 'acceptance run') {
  if (!gpu?.available) throw new Error(`${source}: no WebGL context; hardware renderer evidence unavailable`);
  if (isSoftwareRenderer(gpu)) {
    throw new Error(`${source}: software renderer detected (${gpu.renderer || 'unknown'}); hardware GPU required`);
  }
  if (!gpu.webgl2) throw new Error(`${source}: WebGL2 is required for the hardware acceptance run`);
  return gpu;
}

export async function writeGpuReport(file, report) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(report, null, 2) + '\n');
}
