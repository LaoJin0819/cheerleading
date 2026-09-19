function crc32(data: Uint8Array): number {
  let crc = ~0
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i]
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return ~crc >>> 0
}

function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true)
}

function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true)
}

export function zipFiles(files: { name: string; data: Uint8Array }[]): Blob {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const crc = crc32(file.data)
    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    u32(localView, 0, 0x04034b50)
    u16(localView, 4, 20)
    u32(localView, 14, crc)
    u32(localView, 18, file.data.length)
    u32(localView, 22, file.data.length)
    u16(localView, 26, nameBytes.length)
    local.set(nameBytes, 30)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    u32(centralView, 0, 0x02014b50)
    u16(centralView, 4, 20)
    u16(centralView, 6, 20)
    u32(centralView, 16, crc)
    u32(centralView, 20, file.data.length)
    u32(centralView, 24, file.data.length)
    u16(centralView, 28, nameBytes.length)
    u32(centralView, 42, offset)
    central.set(nameBytes, 46)

    locals.push(local, file.data)
    centrals.push(central)
    offset += local.length + file.data.length
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  u32(eocdView, 0, 0x06054b50)
  u16(eocdView, 8, files.length)
  u16(eocdView, 10, files.length)
  u32(eocdView, 12, centralSize)
  u32(eocdView, 16, offset)

  return new Blob([...locals, ...centrals, eocd], { type: 'application/zip' })
}
