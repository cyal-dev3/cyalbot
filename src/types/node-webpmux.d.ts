declare module 'node-webpmux' {
  export interface AnimFrame {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Duración del fotograma en ms. */
    delay: number;
    blend: boolean;
    dispose: boolean;
  }
  export class Image {
    exif: Buffer | null;
    readonly hasAnim: boolean;
    readonly frames: AnimFrame[] | undefined;
    load(buffer: Buffer): Promise<void>;
    save(path: string | null): Promise<Buffer>;
    /** Con `buffers: true` devuelve cada fotograma como WebP independiente. */
    demux(options: { buffers: true; frame?: number }): Promise<Buffer[]>;
  }
}
