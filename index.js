const http = require('http');
const fsPromise = require('fs').promises;
const fs = require('fs')
const path = require('path');
const repl = require('repl');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------
global.config = {
  port: 3000,
  screenshotPath: path.join(process.env.USERPROFILE || process.env.HOME, 'Documents', 'Escape from Tarkov', 'Screenshots'),
  // screenshotPath: path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads'),
  retainScreenshots: false,
}

// ---------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------
/**
 * 获取最新截图
 */
async function sse(req, res) {
  // Set SSE header
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Heartbeat
  const intervalId = setInterval(() => {
    res.write('\n');
  }, 5000);

  // Subscribe to the positionChange event
  const onPositionChange = (position) => {
    res.write(position);
  };
  global.positionUpdateEmitter.on('positionChange', onPositionChange);

  // Handle client disconnect
  req.connection.on('close', () => {
    global.positionUpdateEmitter.removeListener('positionChange', onPositionChange);
    clearInterval(intervalId);
  });

}

/**
 * Test Case
 * (0,0,0) is the center of the map
 */
let x = 0, y = 0;

function test(res) {
  const xStep = Math.floor(Math.random() * 20) - 10;
  const yStep = Math.floor(Math.random() * 20) - 10;
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`2023-12-29[23-02]_${x = x + xStep}, 0, ${y = y + yStep}_0.0, 0.0, 0.0, 0.0_11.29.png`);
}

// ---------------------------------------------------------------------------------------
// Utools
// ---------------------------------------------------------------------------------------

/**
 * 修改文件名
 */
async function renameFile(dir, fileName, newFileName) {
  const oldFilePath = path.join(dir, fileName);
  const newFilePath = path.join(dir, newFileName);
  await fsPromise.rename(oldFilePath, newFilePath)
  return newFilePath
}

/**
 * 判断文件是否存在
 */
async function fileExists(dir, fileName) {
  try {
    const filePath = path.join(dir, fileName);
    await fsPromise.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    } else {
      throw error;
    }
  }
}

/**
 * Watching screenshot folder, and send a signal of a position change
 */
function watchFolder(folderPath, emitter) {
  const watcher = fs.watch(folderPath, async (eventType, filename) => {
    console.debug(`folder event: ${eventType} ${filename}`)
    // 新增文件时，发出通知并删除文件
    // `fs.rename()` 会产生新旧两个文件名的 `rename` 事件，因此通过判断文件是否存在，过滤掉文件不存在的情况
    if (eventType === 'rename'
      && !filename.startsWith('ignore_')
      && await fileExists(folderPath, filename)
    ) {
      emitter.emit('positionChange', filename);
      console.debug('positionChange:', filename)
      const newFilePath = await renameFile(folderPath, filename, `ignore_${filename}`)
      await fsPromise.rm(newFilePath, { force: true })
    }
  });

  watcher.on('error', (error) => {
    console.error('Watcher error:', error);
  });

  console.log(`Watching for changes in ${folderPath}`);
}


// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

// Register a trigger
const positionUpdateEmitter = new EventEmitter();
global.positionUpdateEmitter = positionUpdateEmitter
watchFolder(global.config.screenshotPath, positionUpdateEmitter);

// HTTP server
const router = async (req, res) => {
  console.debug(`${req.method} ${req.url}`)
  if (req.url === '/') {
    await sse(req, res);
  } else if (req.url === '/test') {
    test(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}
const server = http.createServer(router);
server.listen(global.config.port, () => {
  console.log(`Server is running on port ${global.config.port}`);
});

// REPL CLI tools
const replServer = repl.start({
  prompt: '>> ',
  eval: (input, context, filename, callback) => {
    try {
      const result = eval(input);
      callback(null, result);
    } catch (err) {
      callback(err);
    }
  }
});
console.log('Enter .help to view help');
replServer.defineCommand('config', {
  help: 'show config',
  action(myRepl) {
    console.log('config: ', global.config)
    this.displayPrompt();
  }
});