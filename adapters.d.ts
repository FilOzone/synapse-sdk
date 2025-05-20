/**
 * Synapse SDK Adapters TypeScript Definition
 * 
 * This file defines interfaces for environment-specific adapters.
 * These are not part of the core SDK but demonstrate how to connect
 * environment-specific APIs to the core abstractions.
 */

import {
  ContentSource,
  DirectorySource,
  ContentMetadata
} from './synapse'

/**
 * Common adapter interfaces - implementable in any environment
 */

export interface ContentAdapter {
  /**
   * Create a ContentSource from raw bytes and metadata
   */
  fromBytes(
    bytes: Uint8Array | ArrayBuffer,
    metadata: ContentMetadata
  ): ContentSource

  /**
   * Create a DirectorySource from an array of entries
   */
  fromEntries(
    entries: Array<ContentSource | DirectorySource>,
    metadata: ContentMetadata
  ): DirectorySource
}

/**
 * Node.js specific adapters
 */
export namespace NodeAdapters {
  /**
   * Create a ContentSource from a file path
   */
  export function fileToContent(filePath: string): Promise<ContentSource>

  /**
   * Create a DirectorySource from a directory path
   */
  export function directoryToDirectory(dirPath: string): Promise<DirectorySource>

  /**
   * Write a ContentSource to a file
   */
  export function contentToFile(
    content: ContentSource,
    filePath: string
  ): Promise<void>

  /**
   * Write a DirectorySource to a directory
   */
  export function directoryToFileSystem(
    directory: DirectorySource,
    dirPath: string
  ): Promise<void>

  /**
   * Stream adapter for Node.js streams
   */
  export function streamToContent(
    stream: NodeJS.ReadableStream,
    metadata: ContentMetadata
  ): ContentSource

  /**
   * Create a Node.js readable stream from ContentSource
   */
  export function contentToStream(
    content: ContentSource
  ): NodeJS.ReadableStream
}

/**
 * Browser specific adapters
 */
export namespace BrowserAdapters {
  /**
   * Create a ContentSource from a File object
   */
  export function fileToContent(file: File): ContentSource

  /**
   * Create a DirectorySource from a FileSystemDirectoryHandle
   */
  export function directoryHandleToDirectory(
    dirHandle: FileSystemDirectoryHandle
  ): Promise<DirectorySource>

  /**
   * Download a ContentSource as a file in the browser
   */
  export function contentToDownload(
    content: ContentSource,
    saveAs?: string
  ): Promise<void>

  /**
   * Create a ContentSource from a fetch response
   */
  export function fetchToContent(
    response: Response,
    name?: string
  ): Promise<ContentSource>

  /**
   * Create a ContentSource from a Blob
   */
  export function blobToContent(
    blob: Blob,
    name?: string
  ): ContentSource
}

/**
 * Web streams adapters (works in modern browsers and Node.js)
 */
export namespace StreamAdapters {
  /**
   * Create a ContentSource from a Web ReadableStream
   */
  export function streamToContent(
    stream: ReadableStream<Uint8Array>,
    metadata: ContentMetadata
  ): ContentSource

  /**
   * Create a Web ReadableStream from a ContentSource
   */
  export function contentToStream(
    content: ContentSource
  ): ReadableStream<Uint8Array>

  /**
   * Create a ContentSource that streams from a URL
   */
  export function urlToContent(
    url: string,
    metadata?: Partial<ContentMetadata>
  ): Promise<ContentSource>
}