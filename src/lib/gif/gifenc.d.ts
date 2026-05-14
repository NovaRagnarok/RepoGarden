declare module "gifenc" {
  export interface GifFrameOptions {
    palette?: number[][];
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    repeat?: number;
  }

  export interface GifEncoder {
    writeFrame(
      pixels: Uint8Array | Uint8ClampedArray,
      width: number,
      height: number,
      opts?: GifFrameOptions
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GifEncoder;
  const _default: { GIFEncoder: typeof GIFEncoder };
  export default _default;
}
