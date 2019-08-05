import * as assert from 'assert'


export enum SeekMode {
  Absolute,
  Relative
}

export class BinaryParser {
  private data: Buffer
  private cursor: number = 0

  constructor(data: Buffer) {
    this.data = data
  }

  public readUInt32LE(offset?: number) {
    if(typeof offset == 'number') {
      return this.data.readUInt32LE(offset)
    } else {
      offset = this.cursor
      this.cursor += 4
      return this.data.readUInt32LE(offset)
    }
  }

  public readUInt16LE(offset?: number) {
    if(typeof offset == 'number') {
      return this.data.readUInt16LE(offset)
    } else {
      offset = this.cursor
      this.cursor += 2
      return this.data.readUInt16LE(offset)
    }
  }

  /**
   * Read null terminated string (could be empty string)
   * @param offset
   */
  public readString(offset?: number) {
    if(typeof offset == 'number') {
      let end = offset
      const { data, data: { length } } = this
      while(end < length && data[end] /* != 0 */) {
        end++
      }
      return data.toString('ascii', offset, end)
    } else {
      offset = this.cursor
      let end = offset
      const { data, data: { length } } = this
      while(end < length && data[end] /* != 0 */) {
        end++
      }
      this.cursor = end + <number><unknown>!data[end]
      return data.toString('ascii', offset, end)
    }
  }

  public readBytes(bytes: number) {
    const { data, data: { length } } = this
    assert(this.cursor + bytes <= length, 'Insufficient bytes')
    const start = this.cursor
    this.cursor += bytes
    return data.subarray(start, this.cursor)
  }

  public *asIterator() {
    const length = this.data.length
    for(; this.cursor < length; this.cursor++) yield this.data[this.cursor]
  }

  public reset() {
    this.cursor = 0
  }

  public seek(offset?: number, mode: SeekMode = SeekMode.Absolute) {
    const length = this.data.length
    if(typeof offset == 'number') {
      if(mode == SeekMode.Absolute) {
        assert(offset > 0 && offset <= length, 'Invalid offset')
        this.cursor = offset
      } else {
        const res = this.cursor + offset
        assert(res > 0 && res <= length, 'Invalid offset')
        this.cursor = res
      }
    }
    return this.cursor
  }

  public eof() {
    return this.cursor >= this.data.length
  }
}

export default BinaryParser
