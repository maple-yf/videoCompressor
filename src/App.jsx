import React, { useState, useRef, useMemo } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

const App = () => {
  const [targetWidth, setTargetWidth] = useState(384);
  const [targetHeight, setTargetHeight] = useState(192);
  const [targetBitrate, setTargetBitrate] = useState(100);
  const [originalBitrate, setOriginalBitrate] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(-1);
  const [compressedResults, setCompressedResults] = useState([]);
  const [videoInfos, setVideoInfos] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const ffmpegRef = useRef(new FFmpeg());

  const validation = useMemo(() => {
    const errors = {};
    if (targetWidth <= 0 || targetHeight <= 0) {
      errors.dimensions = "Width and height must be greater than 0.";
    }
    return errors;
  }, [targetWidth, targetHeight]);

  const hasValidationErrors = Object.keys(validation).length > 0;

  const load = async () => {
    try {
      const ffmpeg = ffmpegRef.current;
      ffmpeg.on('log', ({ message }) => {
        console.log('FFmpeg Log:', message);
      });
      ffmpeg.on('progress', ({ progress }) => {
        setProgress(Math.round(progress * 100));
      });

      await ffmpeg.load();
    } catch (error) {
      console.error('FFmpeg load error', error);
      setError('初始化失败，请刷新页面重试');
    }
  };


  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getVideoInfo = async (file) => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      
      video.onloadedmetadata = () => {
        // 估算原始码率（比特/秒）
        const estimatedBitrate = Math.round((file.size * 8) / video.duration);
        // 设置目标码率为100kbps
        setTargetBitrate(100);
        setOriginalBitrate(Math.round(estimatedBitrate / 1000));

        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          size: file.size,
          bitrate: Math.round(estimatedBitrate / 1000),
        });
      };
      video.src = URL.createObjectURL(file);

    });
  };

  const handleFileChange = async (e) => { 
    const files = Array.from(e.target.files);
    const validFiles = files.filter((file) => file.type.startsWith("video/"));
    if (validFiles.length === 0) {
      setError("请选择有效的视频文件");
      return;
    }

    setError('');
    setSelectedFiles(validFiles);
    setCompressedResults([]);

    // 获取所有视频的信息
    try {
      const infos = await Promise.all(
        validFiles.map((file) => getVideoInfo(file))
      );
      setVideoInfos(infos);
    } catch (error) {
      setError("获取视频信息失败，请重试");
      console.error("获取视频信息失败", error);
    }
  };

  const compressVideo = async () => {
    try {
      setIsProcessing(true);
      setError('');

      if (!ffmpegRef.current.loaded) {
        await load();
      }

      const ffmpeg = ffmpegRef.current;
      const results = [];

      for(let i=0; i < selectedFiles.length; i++) {
        try {
          setCurrentFileIndex(i);
          setStatus(`正在处理第 ${i + 1}/${selectedFiles.length} 个视频：${selectedFiles[i].name}`);
          setProgress(0);

          const inputFileName = `input_${i}.mp4`;
          const outputFileName = `output_${i}.mp4`;

          console.log('Writing input file...');
          await ffmpeg.writeFile(inputFileName, await fetchFile(selectedFiles[i]));

          console.log('Starting compression...');
          await ffmpeg.exec([
            "-i", inputFileName,
            "-vf", `scale=${targetWidth}:${targetHeight}`,
            "-c:v", "libx264",
            "-b:v", `${targetBitrate}k`,
            "-maxrate", `${targetBitrate * 1.5}k`,
            "-bufsize", `${targetBitrate * 2}k`,
            "-preset", "medium",
            outputFileName
          ]);

          console.log('Reading output file...');
          const data = await ffmpeg.readFile(outputFileName);
          console.log('Output file size:', data.byteLength);
          
          const blob = new Blob([data], { type: "video/mp4" });
          console.log('Blob size:', blob.size);
          
          results.push({
            originalName: selectedFiles[i].name,
            data: data,
            size: blob.size,
          });

          //清理临时文件
          await ffmpeg.deleteFile(inputFileName);
          await ffmpeg.deleteFile(outputFileName);
        } catch (error) {
          console.error(`Error processing file ${i}:`, error);
          setError(`处理第 ${i + 1} 个视频时出错：${error.message}`);
          throw error;
        }
      }
      setCompressedResults(results);
      setStatus("所有视频压缩完成");
    } catch (error) {
      console.error("Compression error:", error);
      setError("压缩视频时出错：" + error.message);
    } finally {
      setIsProcessing(false);
      setProgress(0);
      setCurrentFileIndex(-1);
    }
  };

  const handleDownload = (result) => {
    try {
      // 使用原生的下载方式
      const blob = new Blob([result.data], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const originalName = result.originalName;
      const extension = originalName.split('.').pop();
      const baseName = originalName.slice(0, -extension.length - 1);
      a.download = `${baseName}_compressed.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("下载失败", error);
      setError("下载失败，请重试");
    }
  };

  const handleDownloadAll = () => {
    compressedResults.forEach((result, index) => {
      setTimeout(() => {
        handleDownload(result);
      }, index * 1000); // 每个文件间隔1秒下载
    });
  };

  return (
    <div className="container">
      <h1 className="title">免费视频压缩工具</h1>

      <div className="upload-section">
        <input
          type="file"
          id="file-input"
          accept="video/mp4"
          multiple
          onChange={handleFileChange}
          disabled={isProcessing}
          className="file-input"
        />
        <div className="upload-wrapper">
          <label htmlFor="file-input" className="button upload-button">
            {selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} 个文件` : '选择视频文件'}
          </label>
          <div className="upload-hint">提示：可以同时选择多个视频文件进行批量压缩</div>
        </div>
        {
          selectedFiles.length > 0 && (
            <div className="selected-files">
              {
                selectedFiles.map((file, index) => {
                  return (
                    <div key={index} className="selected-file">
                      <span className="file-name">{file.name}</span>
                      {
                        currentFileIndex === index && (
                          <div className="file-progress">
                            <div className="file-progress-bar" style={{  width: `${progress}%` }} />
                          </div>
                        )
                      }
                    </div>
                  );
                })
              }
            </div>
          )
        }
      </div>

      <div className="compression-settings">
        <h3>压缩设置</h3>
        <div className="input-group">
          <div className="input-wrapper">
            <label>
              宽度：
              <input
                type="number"
                value={targetWidth}
                onChange={(e) => setTargetWidth(e.target.value)}
                disabled={isProcessing}
                className="input-field"
              />
            </label>
            <label>
              高度：
              <input
                type="number"
                value={targetHeight}
                onChange={(e) => setTargetHeight(e.target.value)}
                disabled={isProcessing}
                className="input-field"
              />
            </label>
          </div>
          <div className="input-wrapper">
            <label>
              码率(kbps)：
              <input
                type="number"
                value={targetBitrate}
                onChange={(e) => setTargetBitrate(e.target.value)}
                disabled={isProcessing}
                className="input-field"
                min="100"
                step="100"
              />
            </label>
          </div>
        </div>
      </div>
      
      <div style={{ textAlign: 'center' }}>
        <button
          className="button"
          onClick={compressVideo}
          disabled={!selectedFiles.length || hasValidationErrors || isProcessing}
        >
          {isProcessing ? "正在压缩..." : "开始压缩"}
        </button>

        {
          compressedResults.length > 0 && (
            <>
              <button
                className="button"
                onClick={handleDownloadAll}
                disabled={isProcessing}
                style={{ marginLeft: '10px' }}
              >
                下载所有压缩视频
              </button>
              <div className="compressed-files">
                {compressedResults.map((result, index) => (
                  <div key={index} className="compressed-file">
                    <span className="file-name">{result.originalName}</span>
                    <button
                      className="button small"
                      onClick={() => handleDownload(result)}
                      disabled={isProcessing}
                    >
                      下载
                    </button>
                  </div>
                ))}
              </div>
            </>
          )
        }
      </div>

      {status && <div className="status">{status}</div>}

      {
        videoInfos.length > 0 && (
          <div className="video-info">
            {
              videoInfos.map((videoInfo, index) => {
                const compressedResult = compressedResults[index];
                return (
                  <div key={index} className="video-info-item">
                    <div className="info-section original-info">
                      <h3>{selectedFiles[index].name}</h3>
                      <div className="info-grid">
                        <div className="info-item">
                          <span className="info-label">宽度：</span>
                          <span className="info-value">{videoInfo.width}px</span>
                        </div>
                        <div className="info-item">
                          <span className="info-label">高度：</span>
                          <span className="info-value">{videoInfo.height}px</span>
                        </div>
                        <div className="info-item">
                          <span className="info-label">文件大小：</span>
                          <span className="info-value">{formatFileSize(videoInfo.size)}</span>
                        </div>
                        <div className="info-item">
                          <span className="info-label">原始码率：</span>
                          <span className="info-value">{videoInfo.bitrate} kbps</span>
                        </div>
                      </div>
                    </div>
                    {
                      compressedResult && (
                        <div className="info-section compressed-info">
                          <h3>压缩后信息</h3>
                          <div className="info-grid">
                            <div className="info-item">
                              <span className="info-label">宽度：</span>
                              <span className="info-value">{targetWidth}px</span>
                            </div>
                            <div className="info-item">
                              <span className="info-label">高度：</span>
                              <span className="info-value">{targetHeight}px</span>
                            </div>
                            <div className="info-item">
                              <span className="info-label">文件大小：</span>
                              <span className="info-value">{formatFileSize(compressedResult.size)}</span>
                            </div>
                            <div className="info-item">
                              <span className="info-label">压缩码率：</span>
                              <span className="info-value">{targetBitrate} kbps</span>
                            </div>
                            <div className="info-item highlight">
                              <span className="info-label">体积减少：</span>
                              <span className="info-value">
                                {((1 - compressedResult.size / videoInfo.size) * 100).toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    }
                  </div>
                );
              })
            }
          </div>
        )
      }

    </div>
  );
};

export default App;