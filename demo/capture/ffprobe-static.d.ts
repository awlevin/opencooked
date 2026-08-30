// ffprobe-static ships no types; it only ever exposes the binary path.
declare module 'ffprobe-static' {
  const ffprobe: { path: string };
  export default ffprobe;
}
