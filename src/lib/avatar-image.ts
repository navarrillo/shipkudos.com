import sharp from "sharp";

/** resvg, used by next/og, does not draw WebP. Always hand it a PNG. */
export async function avatarBufferToDataUri(input: ArrayBuffer | Buffer) {
  const png = await sharp(input, { limitInputPixels: 1000000 })
    .resize(128, 128)
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
