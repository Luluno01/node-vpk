import * as assert from 'assert'
import * as fs from 'fs'
import { crc32 } from 'crc'
import { promisify } from 'util'
const readFile = promisify(fs.readFile)
const open = promisify(fs.open)
const read = promisify(fs.read)
const close = promisify(fs.close)
import BinaryParser from './BinaryParser'


interface VPKEntryMeta {
  extension: string
  folder: string
  fileName: string
  path: string
  CRC: number
  preloadBytes: number
  preload?: Buffer
  archiveIndex: number
  entryOffset: number
  entryLength: number
}

export class VPKFile {
  /**
   * Magic
   */
  private static readonly SIGNATURE = 0x55aa1234
  /**
   * Header size (directory tree not included) of VPK V1 in bytes
   */
  private static readonly HEADER_SIZE_V1 = 3 * 4
  /**
   * Header size (directory tree not included) of VPK V2 in bytes
   */
  private static readonly HEADER_SIZE_V2 = 7 * 4

  /**
   * Underlying VPK file version
   */
  public version: number
  /**
   * How many bytes of file content are stored in this VPK file (0 in CSGO)
   */
	private fileDataSectionSize: number

	/**
   * The size, in bytes, of the section containing MD5 checksums for external
   * archive content
   */
	private archiveMD5SectionSize: number

  /**
   * The size, in bytes, of the section containing MD5 checksums for content
   * in this file (should always be 48)
   */
	private otherMD5SectionSize: number

	/**
   * The size, in bytes, of the section containing the public key and
   * signature. This is either 0 (CSGO & The Ship) or 296 (HL2, HL2:DM,
   * HL2:EP1, HL2:EP2, HL2:LC, TF2, DOD:S & CS:S)
   */
  private signatureSectionSize: number

  /**
   * VPK directory file path
   */
  public path: string
  /**
   * File entries (path => meta)
   */
  public entries: Map<string, VPKEntryMeta> = new Map

  /**
   * Content of the VPK directory file (without header and directory tree)
   */
  private data: Buffer
  /**
   * FD cache (archiveIndex => fd)
   */
  private fdCache: Map<number, number> = new Map

  /**
   * Load VPK file from designated file
   * @param path Path to VPK directory file
   */
  public static async fromFile(path: string) {
    const file = new VPKFile
    const data = await readFile(path)
    file.path = path

    const parser = new BinaryParser(data)

    // Signature
    const signature = parser.readUInt32LE()
    assert(signature == VPKFile.SIGNATURE, 'Invalid file signature (bad magic)')

    // Version
    const version = parser.readUInt32LE()
    assert(version == 1 || version == 2, 'Unsupported file version')
    file.version = version

    // TreeSize
    const treeSize = parser.readUInt32LE()

    let dataOffset: number

    if(version == 2) {
      dataOffset = VPKFile.HEADER_SIZE_V2 + treeSize

      // FileDataSectionSize
      file.fileDataSectionSize = parser.readUInt32LE()

      // ArchiveMD5SectionSize
      file.archiveMD5SectionSize = parser.readUInt32LE()

      // OtherMD5SectionSize
      file.otherMD5SectionSize = parser.readUInt32LE()
      assert(file.otherMD5SectionSize == 48, 'Invalid value of field `OtherMD5SectionSize`')

      // SignatureSectionSize
      file.signatureSectionSize = parser.readUInt32LE()
    } else {
      dataOffset = VPKFile.HEADER_SIZE_V1 + treeSize
    }

    // Tree
    while(true) {
      const extension = parser.readString()
      if(!extension) break
      while(true) {
        const folder = parser.readString()
        if(!folder) break
        while(true) {
          const fileName = parser.readString()
          if(!fileName) break
          const path = `${folder}/${fileName}.${extension}`
          const CRC = parser.readUInt32LE()
          const preloadBytes = parser.readUInt16LE()
          const archiveIndex = parser.readUInt16LE()
          const entryOffset = parser.readUInt32LE()
          const entryLength = parser.readUInt32LE()
          const node: VPKEntryMeta = {
            path,
            extension,
            folder,
            fileName,
            CRC,
            preloadBytes,
            archiveIndex,
            entryOffset,
            entryLength
          }
          assert(parser.readUInt16LE() == 0xffff, 'Bad entry terminator')
          if(preloadBytes) {
            node.preload = parser.readBytes(preloadBytes)
          }
          file.entries.set(path, node)
        }  // File name
      }  // Folder
    }  // Extension
    file.data = data.subarray(dataOffset)
    return file
  }

  /**
   * 
   * @param path File path inside the VPK file(s)
   * (e.g. scripts/items/items_game.txt)
   * @param validate Whether to validate extracted file or not (throw an error
   * when validation failed)
   */
  public async readFile(path: string, validate: boolean = false) {
    path = path.replace(/\\/g, '/')
    const { entries } = this
    assert(entries.has(path), `File ${path} not found`)
    const { archiveIndex, entryOffset, preloadBytes, preload, entryLength, CRC } = entries.get(path)!
    const buff = Buffer.alloc(preloadBytes + entryLength)
    if(preload) {
      preload.copy(buff)
    }
    if(entryLength > 0) {
      if(archiveIndex == 0x7fff) {
        this.data.copy(buff, preloadBytes, entryOffset, entryLength)
      } else {
        const archivePath = this.path.replace(/_dir\.vpk$/, `_${archiveIndex.toString().padStart(3, '0')}.vpk`)
        const fd = await open(archivePath, 'r')
        this.fdCache.set(archiveIndex, fd)
        const { bytesRead } = await read(fd, buff, preloadBytes, entryLength, entryOffset)
        assert(bytesRead == entryLength, `Cannot read file from sub-archive ${archivePath}`)
        if(validate) {
          assert(crc32(buff) == CRC, 'Validation failed')
        }
      }
    }
    return buff
  }

  /**
   * Close all open sub-archives
   */
  public async closeSubArchives() {
    const cache = new Map(this.fdCache.entries())
    this.fdCache.clear()
    await Promise.all<void>([ ...cache.values() ].map(close))
  }
}

export default VPKFile
