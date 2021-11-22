/* eslint-disable no-restricted-globals */
/* eslint-disable no-unused-expressions */
import { BaseLoggger, Html5QrcodeResultFactory, Html5QrcodeErrorFactory, Html5QrcodeSupportedFormats, isValidHtml5QrcodeSupportedFormats, Html5QrcodeConstants, isNullOrUndefined } from "./core.js";
import { Html5QrcodeStrings } from "./strings.js";
import { VideoConstraintsUtil } from "./utils.js";
import { Html5QrcodeShim } from "./code-decoder.js";
import { ExperimentalFeaturesConfigFactory } from "./experimental-features.js";
class Constants extends Html5QrcodeConstants {
}
Constants.DEFAULT_WIDTH = 300;
Constants.DEFAULT_WIDTH_OFFSET = 2;
Constants.FILE_SCAN_MIN_HEIGHT = 300;
Constants.MIN_QR_BOX_SIZE = 50;
Constants.SHADED_LEFT = 1;
Constants.SHADED_RIGHT = 2;
Constants.SHADED_TOP = 3;
Constants.SHADED_BOTTOM = 4;
Constants.SHADED_REGION_CLASSNAME = "qr-shaded-region";
Constants.VERBOSE = false;
Constants.BORDER_SHADER_DEFAULT_COLOR = "#ffffff";
Constants.BORDER_SHADER_MATCH_COLOR = "rgb(90, 193, 56)";
class InternalHtml5QrcodeConfig {
    constructor(config, logger) {
        this.logger = logger;
        this.fps = Constants.SCAN_DEFAULT_FPS;
        if (!config) {
            this.disableFlip = Constants.DEFAULT_DISABLE_FLIP;
        }
        else {
            if (config.fps) {
                this.fps = config.fps;
            }
            this.disableFlip = config.disableFlip === true;
            this.qrbox = config.qrbox;
            this.aspectRatio = config.aspectRatio;
            this.videoConstraints = config.videoConstraints;
        }
    }
    isMediaStreamConstraintsValid() {
        if (!this.videoConstraints) {
            this.logger.logError("Empty videoConstraints", true);
            return false;
        }
        return VideoConstraintsUtil.isMediaStreamConstraintsValid(this.videoConstraints, this.logger);
    }
    isShadedBoxEnabled() {
        return !isNullOrUndefined(this.qrbox);
    }
    static create(config, logger) {
        return new InternalHtml5QrcodeConfig(config, logger);
    }
}
export class Html5Qrcode {
    constructor(elementId, configOrVerbosityFlag) {
        this.element = null;
        this.canvasElement = null;
        this.hasBorderShaders = null;
        this.borderShaders = null;
        this.qrMatch = null;
        this.videoElement = null;
        this.localMediaStream = null;
        this.qrRegion = null;
        this.context = null;
        this.lastScanImageFile = null;
        if (!document.getElementById(elementId)) {
            throw `HTML Element with id=${elementId} not found`;
        }
        this.elementId = elementId;
        this.verbose = false;
        let experimentalFeatureConfig;
        if (typeof configOrVerbosityFlag == "boolean") {
            this.verbose = configOrVerbosityFlag === true;
        }
        else if (configOrVerbosityFlag) {
            this.verbose = configOrVerbosityFlag.verbose === true;
            experimentalFeatureConfig = configOrVerbosityFlag.experimentalFeatures;
        }
        this.logger = new BaseLoggger(this.verbose);
        this.qrcode = new Html5QrcodeShim(this.getSupportedFormats(configOrVerbosityFlag), this.verbose, this.logger, ExperimentalFeaturesConfigFactory.createExperimentalFeaturesConfig(experimentalFeatureConfig));
        // eslint-disable-next-line no-unused-expressions
        this.foreverScanTimeout;
        this.localMediaStream;
        this.shouldScan = true;
        this.isScanning = false;
    }
    start(cameraIdOrConfig, configuration, qrCodeSuccessCallback, qrCodeErrorCallback) {
        if (!cameraIdOrConfig) {
            throw "cameraIdOrConfig is required";
        }
        if (!qrCodeSuccessCallback
            || typeof qrCodeSuccessCallback != "function") {
            throw "qrCodeSuccessCallback is required and should be a function.";
        }
        if (!qrCodeErrorCallback) {
            qrCodeErrorCallback = this.verbose ? this.logger.log : () => { };
        }
        const internalConfig = InternalHtml5QrcodeConfig.create(configuration, this.logger);
        this.clearElement();
        let videoConstraintsAvailableAndValid = false;
        if (internalConfig.videoConstraints) {
            if (!internalConfig.isMediaStreamConstraintsValid()) {
                this.logger.logError("'videoConstraints' is not valid 'MediaStreamConstraints, "
                    + "it will be ignored.'", true);
            }
            else {
                videoConstraintsAvailableAndValid = true;
            }
        }
        const areVideoConstraintsEnabled = videoConstraintsAvailableAndValid;
        const isShadedBoxEnabled = internalConfig.isShadedBoxEnabled();
        const element = document.getElementById(this.elementId);
        const rootElementWidth = element.clientWidth
            ? element.clientWidth : Constants.DEFAULT_WIDTH;
        element.style.position = "relative";
        this.shouldScan = true;
        this.element = element;
        if (isShadedBoxEnabled) {
            this.validateQrboxSize(internalConfig, rootElementWidth);
        }
        const $this = this;
        return new Promise((resolve, reject) => {
            const videoConstraints = areVideoConstraintsEnabled
                ? internalConfig.videoConstraints
                : $this.createVideoConstraints(cameraIdOrConfig);
            if (!videoConstraints) {
                reject("videoConstraints should be defined");
                return;
            }
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: videoConstraints
                }).then((stream) => {
                    $this.onMediaStreamReceived(stream, internalConfig, areVideoConstraintsEnabled, rootElementWidth, qrCodeSuccessCallback, qrCodeErrorCallback)
                        .then((_) => {
                        $this.isScanning = true;
                        resolve(null);
                    })
                        .catch(reject);
                })
                    .catch((error) => {
                    reject(Html5QrcodeStrings.errorGettingUserMedia(error));
                });
            }
            else if (navigator.getUserMedia) {
                if (typeof cameraIdOrConfig != "string") {
                    throw Html5QrcodeStrings.onlyDeviceSupportedError();
                }
                const getCameraConfig = {
                    video: videoConstraints
                };
                navigator.getUserMedia(getCameraConfig, (stream) => {
                    $this.onMediaStreamReceived(stream, internalConfig, areVideoConstraintsEnabled, rootElementWidth, qrCodeSuccessCallback, qrCodeErrorCallback)
                        .then((_) => {
                        $this.isScanning = true;
                        resolve(null);
                    })
                        .catch((error) => {
                        reject(Html5QrcodeStrings.errorGettingUserMedia(error));
                    });
                }, (error) => {
                    reject(Html5QrcodeStrings.errorGettingUserMedia(error));
                });
            }
            else {
                reject(Html5QrcodeStrings.cameraStreamingNotSupported());
            }
        });
    }
    stop() {
        this.shouldScan = false;
        if (this.foreverScanTimeout) {
            clearTimeout(this.foreverScanTimeout);
        }
        const removeQrRegion = () => {
            if (!this.element) {
                return;
            }
            while (this.element.getElementsByClassName(Constants.SHADED_REGION_CLASSNAME).length) {
                const shadedChild = this.element.getElementsByClassName(Constants.SHADED_REGION_CLASSNAME)[0];
                this.element.removeChild(shadedChild);
            }
        };
        return new Promise((resolve, _) => {
            const onAllTracksClosed = () => {
                this.localMediaStream = null;
                if (this.element) {
                    this.element.removeChild(this.videoElement);
                    this.element.removeChild(this.canvasElement);
                }
                removeQrRegion();
                this.isScanning = false;
                if (this.qrRegion) {
                    this.qrRegion = null;
                }
                if (this.context) {
                    this.context = null;
                }
                resolve();
            };
            if (!this.localMediaStream) {
                onAllTracksClosed();
            }
            const tracksToClose = this.localMediaStream.getVideoTracks().length;
            var tracksClosed = 0;
            this.localMediaStream.getVideoTracks().forEach((videoTrack) => {
                this.localMediaStream.removeTrack(videoTrack);
                videoTrack.stop();
                ++tracksClosed;
                if (tracksClosed >= tracksToClose) {
                    onAllTracksClosed();
                }
            });
        });
    }
    scanFile(imageFile, showImage) {
        return this.scanFileV2(imageFile, showImage)
            .then((html5qrcodeResult) => html5qrcodeResult.decodedText);
    }
    scanFileV2(imageFile, showImage) {
        if (!imageFile || !(imageFile instanceof File)) {
            throw "imageFile argument is mandatory and should be instance "
                + "of File. Use 'event.target.files[0]'.";
        }
        if (isNullOrUndefined(showImage)) {
            showImage = true;
        }
        if (this.isScanning) {
            throw "Close ongoing scan before scanning a file.";
        }
        return new Promise((resolve, reject) => {
            this.possiblyCloseLastScanImageFile();
            this.clearElement();
            this.lastScanImageFile = URL.createObjectURL(imageFile);
            const inputImage = new Image;
            inputImage.onload = () => {
                const imageWidth = inputImage.width;
                const imageHeight = inputImage.height;
                const element = document.getElementById(this.elementId);
                const containerWidth = element.clientWidth
                    ? element.clientWidth : Constants.DEFAULT_WIDTH;
                const containerHeight = Math.max(element.clientHeight ? element.clientHeight : imageHeight, Constants.FILE_SCAN_MIN_HEIGHT);
                const config = this.computeCanvasDrawConfig(imageWidth, imageHeight, containerWidth, containerHeight);
                if (showImage) {
                    const visibleCanvas = this.createCanvasElement(containerWidth, containerHeight, "qr-canvas-visible");
                    visibleCanvas.style.display = "inline-block";
                    element.appendChild(visibleCanvas);
                    const context = visibleCanvas.getContext("2d");
                    if (!context) {
                        throw "Unable to get 2d context from canvas";
                    }
                    context.canvas.width = containerWidth;
                    context.canvas.height = containerHeight;
                    context.drawImage(inputImage, 0, 0, imageWidth, imageHeight, config.x, config.y, config.width, config.height);
                }
                const hiddenCanvas = this.createCanvasElement(config.width, config.height);
                element.appendChild(hiddenCanvas);
                const context = hiddenCanvas.getContext("2d");
                if (!context) {
                    throw "Unable to get 2d context from canvas";
                }
                context.canvas.width = config.width;
                context.canvas.height = config.height;
                context.drawImage(inputImage, 0, 0, imageWidth, imageHeight, 0, 0, config.width, config.height);
                try {
                    this.qrcode.decodeAsync(hiddenCanvas)
                        .then((result) => {
                        resolve(Html5QrcodeResultFactory.createFromQrcodeResult(result));
                    })
                        .catch(reject);
                }
                catch (exception) {
                    reject(`QR code parse error, error = ${exception}`);
                }
            };
            inputImage.onerror = reject;
            inputImage.onabort = reject;
            inputImage.onstalled = reject;
            inputImage.onsuspend = reject;
            inputImage.src = URL.createObjectURL(imageFile);
        });
    }
    clear() {
        this.clearElement();
    }
    static getCameras() {
        if (navigator.mediaDevices) {
            return Html5Qrcode.getCamerasFromMediaDevices();
        }
        var mst = MediaStreamTrack;
        if (MediaStreamTrack && mst.getSources) {
            return Html5Qrcode.getCamerasFromMediaStreamTrack();
        }
        const isHttpsOrLocalhost = () => {
            if (location.protocol === "https:") {
                return true;
            }
            const host = location.host.split(":")[0];
            return host === "127.0.0.1" || host === "localhost";
        };
        let errorMessage = Html5QrcodeStrings.unableToQuerySupportedDevices();
        if (!isHttpsOrLocalhost()) {
            errorMessage = Html5QrcodeStrings.insecureContextCameraQueryError();
        }
        return Promise.reject(errorMessage);
    }
    getRunningTrackCapabilities() {
        if (this.localMediaStream == null) {
            throw "Scanning is not in running state, call this API only when"
                + " QR code scanning using camera is in running state.";
        }
        if (this.localMediaStream.getVideoTracks().length === 0) {
            throw "No video tracks found";
        }
        const videoTrack = this.localMediaStream.getVideoTracks()[0];
        return videoTrack.getCapabilities();
    }
    applyVideoConstraints(videoConstaints) {
        if (!videoConstaints) {
            throw "videoConstaints is required argument.";
        }
        else if (!VideoConstraintsUtil.isMediaStreamConstraintsValid(videoConstaints, this.logger)) {
            throw "invalid videoConstaints passed, check logs for more details";
        }
        if (this.localMediaStream === null) {
            throw "Scanning is not in running state, call this API only when"
                + " QR code scanning using camera is in running state.";
        }
        if (this.localMediaStream.getVideoTracks().length === 0) {
            throw "No video tracks found";
        }
        return new Promise((resolve, reject) => {
            if ("aspectRatio" in videoConstaints) {
                reject("Chaning 'aspectRatio' in run-time is not yet "
                    + "supported.");
                return;
            }
            const videoTrack = this.localMediaStream.getVideoTracks()[0];
            videoTrack.applyConstraints(videoConstaints)
                .then((_) => {
                resolve(_);
            })
                .catch((error) => {
                reject(error);
            });
        });
    }
    static getCamerasFromMediaDevices() {
        return new Promise((resolve, reject) => {
            navigator.mediaDevices.getUserMedia({ audio: false, video: true })
                .then((stream) => {
                const closeActiveStreams = (stream) => {
                    const tracks = stream.getVideoTracks();
                    for (const track of tracks) {
                        track.enabled = false;
                        track.stop();
                        stream.removeTrack(track);
                    }
                };
                navigator.mediaDevices.enumerateDevices()
                    .then((devices) => {
                    const results = [];
                    for (const device of devices) {
                        if (device.kind === "videoinput") {
                            results.push({
                                id: device.deviceId,
                                label: device.label
                            });
                        }
                    }
                    closeActiveStreams(stream);
                    resolve(results);
                })
                    .catch((err) => {
                    reject(`${err.name} : ${err.message}`);
                });
            })
                .catch((err) => {
                reject(`${err.name} : ${err.message}`);
            });
        });
    }
    static getCamerasFromMediaStreamTrack() {
        return new Promise((resolve, _) => {
            const callback = (sourceInfos) => {
                const results = [];
                for (const sourceInfo of sourceInfos) {
                    if (sourceInfo.kind === "video") {
                        results.push({
                            id: sourceInfo.id,
                            label: sourceInfo.label
                        });
                    }
                }
                resolve(results);
            };
            var mst = MediaStreamTrack;
            mst.getSources(callback);
        });
    }
    getSupportedFormats(configOrVerbosityFlag) {
        const allFormats = [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.AZTEC,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.MAXICODE,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.PDF_417,
            Html5QrcodeSupportedFormats.RSS_14,
            Html5QrcodeSupportedFormats.RSS_EXPANDED,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
        ];
        if (!configOrVerbosityFlag
            || typeof configOrVerbosityFlag == "boolean") {
            return allFormats;
        }
        if (!configOrVerbosityFlag.formatsToSupport) {
            return allFormats;
        }
        if (!Array.isArray(configOrVerbosityFlag.formatsToSupport)) {
            throw "configOrVerbosityFlag.formatsToSupport should be undefined "
                + "or an array.";
        }
        if (configOrVerbosityFlag.formatsToSupport.length === 0) {
            throw "Atleast 1 formatsToSupport is needed.";
        }
        const supportedFormats = [];
        for (const format of configOrVerbosityFlag.formatsToSupport) {
            if (isValidHtml5QrcodeSupportedFormats(format)) {
                supportedFormats.push(format);
            }
            else {
                this.logger.warn(`Invalid format: ${format} passed in config, ignoring.`);
            }
        }
        if (supportedFormats.length === 0) {
            throw "None of formatsToSupport match supported values.";
        }
        return supportedFormats;
    }
    validateQrboxSize(internalConfig, rootElementWidth) {
        const qrboxSize = internalConfig.qrbox;
        this.validateQrboxConfig(qrboxSize);
        let qrDimensions = this.toQrdimensions(qrboxSize);
        const validateMinSize = (size) => {
            if (size < Constants.MIN_QR_BOX_SIZE) {
                throw "minimum size of 'config.qrbox' dimension value is"
                    + ` ${Constants.MIN_QR_BOX_SIZE}px.`;
            }
        };
        const validateAgainstRootElementSize = (size) => {
            if (size > rootElementWidth) {
                throw "'config.qrbox' dimensions values should not be greater "
                    + "than the width of the HTML element.";
            }
        };
        validateMinSize(qrDimensions.width);
        validateMinSize(qrDimensions.height);
        validateAgainstRootElementSize(qrDimensions.width);
    }
    validateQrboxConfig(qrboxSize) {
        if (typeof qrboxSize === "number") {
            return;
        }
        if (qrboxSize.width === undefined || qrboxSize.height === undefined) {
            throw "Invalid instance of QrDimensions passed for "
                + "'config.qrbox'.";
        }
    }
    toQrdimensions(qrboxSize) {
        if (typeof qrboxSize === "number") {
            return { width: qrboxSize, height: qrboxSize };
        }
        return qrboxSize;
    }
    setupUi(width, height, internalConfig) {
        const qrboxSize = internalConfig.qrbox;
        this.validateQrboxConfig(qrboxSize);
        let qrDimensions = this.toQrdimensions(qrboxSize);
        if (qrDimensions.height > height) {
            this.logger.warn("[Html5Qrcode] config.qrbox has height that is"
                + "greater than the height of the video stream. Shading will be"
                + " ignored");
        }
        const shouldShadingBeApplied = internalConfig.isShadedBoxEnabled()
            && qrDimensions.height <= height;
        const defaultQrRegion = {
            x: 0,
            y: 0,
            width: width,
            height: height
        };
        const qrRegion = shouldShadingBeApplied
            ? this.getShadedRegionBounds(width, height, qrDimensions)
            : defaultQrRegion;
        const canvasElement = this.createCanvasElement(qrRegion.width, qrRegion.height);
        const context = canvasElement.getContext("2d");
        context.canvas.width = qrRegion.width;
        context.canvas.height = qrRegion.height;
        this.element.append(canvasElement);
        if (shouldShadingBeApplied) {
            this.possiblyInsertShadingElement(this.element, width, height, qrDimensions);
        }
        this.qrRegion = qrRegion;
        this.context = context;
        this.canvasElement = canvasElement;
    }
    scanContext(qrCodeSuccessCallback, qrCodeErrorCallback) {
        return this.qrcode.decodeAsync(this.canvasElement)
            .then((result) => {
            qrCodeSuccessCallback(result.text, Html5QrcodeResultFactory.createFromQrcodeResult(result));
            this.possiblyUpdateShaders(true);
            return true;
        }).catch((error) => {
            this.possiblyUpdateShaders(false);
            let errorMessage = Html5QrcodeStrings.codeParseError(error);
            qrCodeErrorCallback(errorMessage, Html5QrcodeErrorFactory.createFrom(errorMessage));
            return false;
        });
    }
    foreverScan(internalConfig, qrCodeSuccessCallback, qrCodeErrorCallback) {
        if (!this.shouldScan) {
            return;
        }
        if (!this.localMediaStream) {
            return;
        }
        const videoElement = this.videoElement;
        const widthRatio = videoElement.videoWidth / videoElement.clientWidth;
        const heightRatio = videoElement.videoHeight / videoElement.clientHeight;
        if (!this.qrRegion) {
            throw "qrRegion undefined when localMediaStream is ready.";
        }
        const sWidthOffset = this.qrRegion.width * widthRatio;
        const sHeightOffset = this.qrRegion.height * heightRatio;
        const sxOffset = this.qrRegion.x * widthRatio;
        const syOffset = this.qrRegion.y * heightRatio;
        this.context.drawImage(videoElement, sxOffset, syOffset, sWidthOffset, sHeightOffset, 0, 0, this.qrRegion.width, this.qrRegion.height);
        const triggerNextScan = () => {
            this.foreverScanTimeout = setTimeout(() => {
                this.foreverScan(internalConfig, qrCodeSuccessCallback, qrCodeErrorCallback);
            }, this.getTimeoutFps(internalConfig.fps));
        };
        this.scanContext(qrCodeSuccessCallback, qrCodeErrorCallback)
            .then((isSuccessfull) => {
            if (!isSuccessfull && internalConfig.disableFlip !== true) {
                this.context.translate(this.context.canvas.width, 0);
                this.context.scale(-1, 1);
                this.scanContext(qrCodeSuccessCallback, qrCodeErrorCallback)
                    .finally(() => {
                    triggerNextScan();
                });
            }
            else {
                triggerNextScan();
            }
        }).catch((error) => {
            this.logger.logError("Error happend while scanning context", error);
            triggerNextScan();
        });
    }
    onMediaStreamReceived(mediaStream, internalConfig, areVideoConstraintsEnabled, clientWidth, qrCodeSuccessCallback, qrCodeErrorCallback) {
        const $this = this;
        return new Promise((resolve, reject) => {
            const setupVideo = () => {
                const videoElement = this.createVideoElement(clientWidth);
                $this.element.append(videoElement);
                videoElement.onabort = reject;
                videoElement.onerror = reject;
                videoElement.onplaying = () => {
                    const videoWidth = videoElement.clientWidth;
                    const videoHeight = videoElement.clientHeight;
                    $this.setupUi(videoWidth, videoHeight, internalConfig);
                    $this.foreverScan(internalConfig, qrCodeSuccessCallback, qrCodeErrorCallback);
                    resolve(null);
                };
                videoElement.srcObject = mediaStream;
                videoElement.play();
                $this.videoElement = videoElement;
            };
            $this.localMediaStream = mediaStream;
            if (areVideoConstraintsEnabled || !internalConfig.aspectRatio) {
                setupVideo();
            }
            else {
                const constraints = {
                    aspectRatio: internalConfig.aspectRatio
                };
                const track = mediaStream.getVideoTracks()[0];
                track.applyConstraints(constraints)
                    .then((_) => setupVideo())
                    .catch((error) => {
                    $this.logger.logErrors(["[Html5Qrcode] Constriants could not "
                            + "be satisfied, ignoring constraints",
                        error]);
                    setupVideo();
                });
            }
        });
    }
    createVideoConstraints(cameraIdOrConfig) {
        if (typeof cameraIdOrConfig == "string") {
            return { deviceId: { exact: cameraIdOrConfig } };
        }
        else if (typeof cameraIdOrConfig == "object") {
            const facingModeKey = "facingMode";
            const deviceIdKey = "deviceId";
            const allowedFacingModeValues = { "user": true, "environment": true };
            const exactKey = "exact";
            const isValidFacingModeValue = (value) => {
                if (value in allowedFacingModeValues) {
                    return true;
                }
                else {
                    throw "config has invalid 'facingMode' value = "
                        + `'${value}'`;
                }
            };
            const keys = Object.keys(cameraIdOrConfig);
            if (keys.length !== 1) {
                throw "'cameraIdOrConfig' object should have exactly 1 key,"
                    + ` if passed as an object, found ${keys.length} keys`;
            }
            const key = Object.keys(cameraIdOrConfig)[0];
            if (key !== facingModeKey && key !== deviceIdKey) {
                throw `Only '${facingModeKey}' and '${deviceIdKey}' `
                    + " are supported for 'cameraIdOrConfig'";
            }
            if (key === facingModeKey) {
                const facingMode = cameraIdOrConfig.facingMode;
                if (typeof facingMode == "string") {
                    if (isValidFacingModeValue(facingMode)) {
                        return { facingMode: facingMode };
                    }
                }
                else if (typeof facingMode == "object") {
                    if (exactKey in facingMode) {
                        if (isValidFacingModeValue(facingMode[`${exactKey}`])) {
                            return {
                                facingMode: {
                                    exact: facingMode[`${exactKey}`]
                                }
                            };
                        }
                    }
                    else {
                        throw "'facingMode' should be string or object with"
                            + ` ${exactKey} as key.`;
                    }
                }
                else {
                    const type = (typeof facingMode);
                    throw `Invalid type of 'facingMode' = ${type}`;
                }
            }
            else {
                const deviceId = cameraIdOrConfig.deviceId;
                if (typeof deviceId == "string") {
                    return { deviceId: deviceId };
                }
                else if (typeof deviceId == "object") {
                    if (exactKey in deviceId) {
                        return {
                            deviceId: { exact: deviceId[`${exactKey}`] }
                        };
                    }
                    else {
                        throw "'deviceId' should be string or object with"
                            + ` ${exactKey} as key.`;
                    }
                }
                else {
                    const type = (typeof deviceId);
                    throw `Invalid type of 'deviceId' = ${type}`;
                }
            }
        }
        const type = (typeof cameraIdOrConfig);
        throw `Invalid type of 'cameraIdOrConfig' = ${type}`;
    }
    computeCanvasDrawConfig(imageWidth, imageHeight, containerWidth, containerHeight) {
        if (imageWidth <= containerWidth
            && imageHeight <= containerHeight) {
            const xoffset = (containerWidth - imageWidth) / 2;
            const yoffset = (containerHeight - imageHeight) / 2;
            return {
                x: xoffset,
                y: yoffset,
                width: imageWidth,
                height: imageHeight
            };
        }
        else {
            const formerImageWidth = imageWidth;
            const formerImageHeight = imageHeight;
            if (imageWidth > containerWidth) {
                imageHeight = (containerWidth / imageWidth) * imageHeight;
                imageWidth = containerWidth;
            }
            if (imageHeight > containerHeight) {
                imageWidth = (containerHeight / imageHeight) * imageWidth;
                imageHeight = containerHeight;
            }
            this.logger.log("Image downsampled from "
                + `${formerImageWidth}X${formerImageHeight}`
                + ` to ${imageWidth}X${imageHeight}.`);
            return this.computeCanvasDrawConfig(imageWidth, imageHeight, containerWidth, containerHeight);
        }
    }
    clearElement() {
        if (this.isScanning) {
            throw "Cannot clear while scan is ongoing, close it first.";
        }
        const element = document.getElementById(this.elementId);
        if (element) {
            element.innerHTML = "";
        }
    }
    createVideoElement(width) {
        const videoElement = document.createElement("video");
        videoElement.style.width = `${width}px`;
        videoElement.muted = true;
        videoElement.setAttribute("muted", "true");
        videoElement.playsInline = true;
        return videoElement;
    }
    possiblyUpdateShaders(qrMatch) {
        if (this.qrMatch === qrMatch) {
            return;
        }
        if (this.hasBorderShaders
            && this.borderShaders
            && this.borderShaders.length) {
            this.borderShaders.forEach((shader) => {
                shader.style.backgroundColor = qrMatch
                    ? Constants.BORDER_SHADER_MATCH_COLOR
                    : Constants.BORDER_SHADER_DEFAULT_COLOR;
            });
        }
        this.qrMatch = qrMatch;
    }
    possiblyCloseLastScanImageFile() {
        if (this.lastScanImageFile) {
            URL.revokeObjectURL(this.lastScanImageFile);
            this.lastScanImageFile = null;
        }
    }
    createCanvasElement(width, height, customId) {
        const canvasWidth = width;
        const canvasHeight = height;
        const canvasElement = document.createElement("canvas");
        canvasElement.style.width = `${canvasWidth}px`;
        canvasElement.style.height = `${canvasHeight}px`;
        canvasElement.style.display = "none";
        canvasElement.id = isNullOrUndefined(customId)
            ? "qr-canvas" : customId;
        return canvasElement;
    }
    getShadedRegionBounds(width, height, qrboxSize) {
        if (qrboxSize.width > width || qrboxSize.height > height) {
            throw "'config.qrbox' dimensions should not be greater than the "
                + "dimensions of the root HTML element.";
        }
        return {
            x: (width - qrboxSize.width) / 2,
            y: (height - qrboxSize.height) / 2,
            width: qrboxSize.width,
            height: qrboxSize.height
        };
    }
    possiblyInsertShadingElement(element, width, height, qrboxSize) {
        if ((width - qrboxSize.width) < 1 || (height - qrboxSize.height) < 1) {
            return;
        }
        const shadingElement = document.createElement("div");
        shadingElement.style.position = "absolute";
        const rightLeftBorderSize = (width - qrboxSize.width) / 2;
        const topBottomBorderSize = (height - qrboxSize.height) / 2;
        shadingElement.style.borderLeft
            = `${rightLeftBorderSize}px solid #0000007a`;
        shadingElement.style.borderRight
            = `${rightLeftBorderSize}px solid #0000007a`;
        shadingElement.style.borderTop
            = `${topBottomBorderSize}px solid #0000007a`;
        shadingElement.style.borderBottom
            = `${topBottomBorderSize}px solid #0000007a`;
        shadingElement.style.boxSizing = "border-box";
        shadingElement.style.top = "0px";
        shadingElement.style.bottom = "0px";
        shadingElement.style.left = "0px";
        shadingElement.style.right = "0px";
        shadingElement.id = `${Constants.SHADED_REGION_CLASSNAME}`;
        if ((width - qrboxSize.width) < 11
            || (height - qrboxSize.height) < 11) {
            this.hasBorderShaders = false;
        }
        else {
            const smallSize = 5;
            const largeSize = 40;
            this.insertShaderBorders(shadingElement, largeSize, smallSize, -smallSize, 0, true);
            this.insertShaderBorders(shadingElement, largeSize, smallSize, -smallSize, 0, false);
            this.insertShaderBorders(shadingElement, largeSize, smallSize, qrboxSize.height + smallSize, 0, true);
            this.insertShaderBorders(shadingElement, largeSize, smallSize, qrboxSize.height + smallSize, 0, false);
            this.insertShaderBorders(shadingElement, smallSize, largeSize + smallSize, -smallSize, -smallSize, true);
            this.insertShaderBorders(shadingElement, smallSize, largeSize + smallSize, qrboxSize.height + smallSize - largeSize, -smallSize, true);
            this.insertShaderBorders(shadingElement, smallSize, largeSize + smallSize, -smallSize, -smallSize, false);
            this.insertShaderBorders(shadingElement, smallSize, largeSize + smallSize, qrboxSize.height + smallSize - largeSize, -smallSize, false);
            this.hasBorderShaders = true;
        }
        element.append(shadingElement);
    }
    insertShaderBorders(shaderElem, width, height, top, side, isLeft) {
        const elem = document.createElement("div");
        elem.style.position = "absolute";
        elem.style.backgroundColor = Constants.BORDER_SHADER_DEFAULT_COLOR;
        elem.style.width = `${width}px`;
        elem.style.height = `${height}px`;
        elem.style.top = `${top}px`;
        if (isLeft) {
            elem.style.left = `${side}px`;
        }
        else {
            elem.style.right = `${side}px`;
        }
        if (!this.borderShaders) {
            this.borderShaders = [];
        }
        this.borderShaders.push(elem);
        shaderElem.appendChild(elem);
    }
    getTimeoutFps(fps) {
        return 1000 / fps;
    }
}
//# sourceMappingURL=html5-qrcode.js.map