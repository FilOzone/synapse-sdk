/**
 * Example usage of the Synapse SDK with environment-specific adapters
 * 
 * This file demonstrates how to use the SDK with the adapters in both
 * Node.js and browser environments.
 */

// -----------------------------------------------------------------------------
// Node.js environment example
// -----------------------------------------------------------------------------

// Node.js specific import example
const { Synapse } = require('synapse-sdk')
const { NodeAdapters } = require('synapse-sdk-node')

// Initialize Synapse
const synapse = new Synapse({
  rpcUrl: 'wss://wss.node.glif.io/apigw/lotus/rpc/v1',
  privateKey: process.env.PRIVATE_KEY
})

// Create storage service
const storage = synapse.createStorage({
  duration: 90,
  replicas: 3,
  retrievalCheck: 2
})

// Upload a file using the Node.js adapter
async function uploadFile(filePath) {
  // Convert the file path to a ContentSource
  const content = await NodeAdapters.fileToContent(filePath)
  
  // Upload the content
  const cid = await storage.upload(content, {
    wrapWithDirectory: true
  })
  
  console.log(`Uploaded ${filePath} with CID: ${cid}`)
  return cid
}

// Upload a directory using the Node.js adapter
async function uploadDirectory(dirPath) {
  // Convert the directory path to a DirectorySource
  const directory = await NodeAdapters.directoryToDirectory(dirPath)
  
  // Upload the directory
  const cid = await storage.uploadDirectory(directory)
  
  console.log(`Uploaded directory ${dirPath} with CID: ${cid}`)
  return cid
}

// Download a file using the Node.js adapter
async function downloadFile(cid, outputPath) {
  // Download the content
  const content = await storage.download(cid)
  
  // Write the content to a file
  await NodeAdapters.contentToFile(content, outputPath)
  
  console.log(`Downloaded ${cid} to ${outputPath}`)
}

// Download a directory using the Node.js adapter
async function downloadDirectory(cid, outputDir) {
  // Download the directory
  const directory = await storage.downloadDirectory(cid)
  
  // Write the directory to the filesystem
  await NodeAdapters.directoryToFileSystem(directory, outputDir)
  
  console.log(`Downloaded directory ${cid} to ${outputDir}`)
}

// -----------------------------------------------------------------------------
// Browser environment example
// -----------------------------------------------------------------------------

// This would be in a separate file or using a bundler that handles different
// environments

// Browser-specific import example (using ES modules)
import { Synapse } from 'synapse-sdk'
import { BrowserAdapters } from 'synapse-sdk-browser'

// Initialize Synapse (browser version)
const synapseWeb = new Synapse({
  rpcUrl: 'wss://wss.node.glif.io/apigw/lotus/rpc/v1',
  privateKey: localStorage.getItem('privateKey')
})

// Create storage service
const storageWeb = synapseWeb.createStorage({
  duration: 90,
  replicas: 3,
  retrievalCheck: 2
})

// Upload a file from input element
async function handleFileUpload(event) {
  const file = event.target.files[0]
  if (!file) return
  
  // Convert the File object to a ContentSource
  const content = BrowserAdapters.fileToContent(file)
  
  // Show progress
  setStatus(`Uploading ${file.name}...`)
  
  try {
    // Upload the content
    const cid = await storageWeb.upload(content)
    setStatus(`Uploaded ${file.name} with CID: ${cid}`)
    setCid(cid)
  } catch (error) {
    setStatus(`Upload failed: ${error.message}`)
  }
}

// Upload a directory using the File System Access API
async function handleDirectoryUpload() {
  try {
    // Request directory access
    const dirHandle = await window.showDirectoryPicker()
    
    // Convert the directory handle to a DirectorySource
    const directory = await BrowserAdapters.directoryHandleToDirectory(dirHandle)
    
    // Show progress
    setStatus(`Uploading directory ${directory.metadata.name}...`)
    
    // Upload the directory
    const cid = await storageWeb.uploadDirectory(directory)
    
    setStatus(`Uploaded directory with CID: ${cid}`)
    setCid(cid)
  } catch (error) {
    setStatus(`Directory upload failed: ${error.message}`)
  }
}

// Download a file in the browser
async function handleDownload(cid) {
  try {
    setStatus(`Downloading ${cid}...`)
    
    // Download the content
    const content = await storageWeb.download(cid)
    
    // Trigger download in the browser
    await BrowserAdapters.contentToDownload(content)
    
    setStatus(`Downloaded ${content.metadata.name}`)
  } catch (error) {
    setStatus(`Download failed: ${error.message}`)
  }
}

// -----------------------------------------------------------------------------
// Web application example setup (browser)
// -----------------------------------------------------------------------------

// Example HTML for browser usage
/*
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Synapse SDK Demo</title>
</head>
<body>
    <h1>Synapse SDK Browser Demo</h1>
    
    <div>
        <h2>Upload</h2>
        <input type="file" id="fileInput">
        <button id="directoryBtn">Select Directory</button>
    </div>
    
    <div>
        <h2>Download</h2>
        <input type="text" id="cidInput" placeholder="Enter CID to download">
        <button id="downloadBtn">Download</button>
    </div>
    
    <div id="status"></div>
    
    <script type="module" src="example-browser.js"></script>
</body>
</html>
*/

// Browser event handling (would be in the browser JS file)
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput')
  const directoryBtn = document.getElementById('directoryBtn')
  const downloadBtn = document.getElementById('downloadBtn')
  const cidInput = document.getElementById('cidInput')
  
  fileInput.addEventListener('change', handleFileUpload)
  directoryBtn.addEventListener('click', handleDirectoryUpload)
  downloadBtn.addEventListener('click', () => {
    const cid = cidInput.value.trim()
    if (cid) {
      handleDownload(cid)
    }
  })
})

// Helper functions for browser example
function setStatus(message) {
  document.getElementById('status').textContent = message
}

function setCid(cid) {
  document.getElementById('cidInput').value = cid
}