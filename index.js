"use strict";

var ts = require("typescript");
var getDefaultCompilerOptions = require("./options").getDefaultCompilerOptions;
var convertCompilerOptionsOrThrow = require("./options").convertCompilerOptionsOrThrow;
var CompileService = require("./compile-service").CompileService;
var ServiceHost = require("./compile-service-host").CompileServiceHost;
var sourceHost = require("./files-source-host").sourceHost;
var deepHash = require("./utils").deepHash;
var CompileCache = require("./cache").CompileCache;
var FileCache = require("./cache").FileCache;
var utils = require("./utils");
var _ = require("underscore");

var compileCache;
var typingsCache;
function setCacheDir(cacheDir) {
  if (compileCache && compileCache.cacheDir === cacheDir) {
    return;
  }

  compileCache = new CompileCache(cacheDir);
  typingsCache = new FileCache(cacheDir);
};

exports.setCacheDir = setCacheDir;

function getConvertedDefault() {
  return convertCompilerOptionsOrThrow(
    getDefaultCompilerOptions());
}

var serviceHost;
var compileService;
var docRegistry;

function lazyInit() {
  if (! compileCache) {
    setCacheDir();
  }

  if (! docRegistry) {
    docRegistry = ts.createDocumentRegistry();
  }

  if (! serviceHost) {
    serviceHost = new ServiceHost(compileCache, typingsCache);
  }

  if (! compileService) {
    compileService = new CompileService(serviceHost, docRegistry);
  }
}

function TSBuild(filePaths, getFileContent, options) {
  validateAndConvertOptions(options);

  lazyInit();

  if (! options)
    options = {compilerOptions: getConvertedDefault()};

  if (! options.compilerOptions) 
    options.compilerOptions = getConvertedDefault();

  this.options = options;

  sourceHost.setSource(getFileContent);

  serviceHost.setFiles(filePaths, options);

  this.rebuildMap = getRebuildMap(filePaths, options);
}

function rebuildWithNewTypings(filePath, typings) {
  typings = typings || [];
  var rebuild = typingsCache.isChanged(filePath, typings);
  typingsCache.save(filePath, typings);

  var tLen = typings.length;
  for (var i = 0; i < tLen; i++) {
    var path = typings[i];
    if (typingsCache.isChanged(path)) {
      typingsCache.save(path);
      rebuild = true;
    }
  }

  return rebuild;
}

function getRebuildMap(filePaths, options) {
  var files = {};

  var appPath = ts.sys.getCurrentDirectory();
  if (rebuildWithNewTypings(appPath, options.typings)) {
    _.each(filePaths, function(filePath) {
      files[filePath] = true;
    });
    return files;
  }

  _.each(filePaths, function(filePath) {
    if (! compileCache.resultChanged(filePath, options)) {
      var result = compileCache.get(filePath, options);
      var refs = result.references;
      if (refs) {
        files[filePath] = rebuildWithNewTypings(filePath, refs.typings);
        if (files[filePath]) return;

        var modules = refs.modules;
        var mLen = modules.length;
        for (var i = 0; i < mLen; i++) {
          if (compileCache.resultChanged(modules[i], options)) {
            files[filePath] = true;
            break;
          }
        }
      }
    }
  });

  return files;
}

exports.TSBuild = TSBuild;

var BP = TSBuild.prototype;

BP.emit = function(filePath, moduleName) {
  var options = this.options;
  var useCache = options && options.useCache;

  if (useCache === false) {
    return compileService.compile(filePath, moduleName);
  }

  return compileCache.get(filePath, options, function() {
    return compileService.compile(filePath, moduleName);
  }, this.rebuildMap[filePath]);
};

exports.compile = function compile(fileContent, options) {
  if (typeof fileContent !== "string") {
    throw new Error("fileContent should be a string");
  }

  var optPath = options && options.filePath;
  var moduleName = options && options.moduleName;

  if (! optPath) {
    optPath = deepHash(fileContent, options);
    var tsx = (options && options.compilerOptions && 
      options.compilerOptions.jsx);
    optPath += tsx ? ".tsx" : ".ts";
  }

  var getFileContent = function(filePath) {
    if (filePath === optPath) {
      return fileContent;
    }
  }

  var newBuild = new TSBuild([optPath], getFileContent, options);
  return newBuild.emit(optPath, moduleName);
};

var validOptions = {
  "compilerOptions": "Object",
  "filePath": "String",
  "moduleName": "String",
  "typings": "Array",
  "arch": "String",
  "useCache": "Boolean"
};
var validOptionsMsg = "Valid options are " +
  "compilerOptions, filePath, moduleName, and typings.";

function checkType(option, optionName) {
  if (! option) return true;

  return option.constructor.name === validOptions[optionName];
}

function validateAndConvertOptions(options) {
  if (! options) return;

  // Validate top level options.
  for (var option in options) {
    if (options.hasOwnProperty(option)) {
      if (validOptions[option] === undefined) {
        throw new Error("Unknown option: " + option + ".\n" +
          validOptionsMsg);
      }

      if (! checkType(options[option], option)) {
        throw new Error(option + " should be of type " +
          validOptions[option]);
      }
    }
  }

  // Validate and convert compilerOptions.
  if (options.compilerOptions) {
    options.compilerOptions = convertCompilerOptionsOrThrow(
      options.compilerOptions);
  }
}

exports.validateAndConvertOptions = validateAndConvertOptions;

exports.getDefaultOptions = function getDefaultOptions() {
  return {
    compilerOptions: getDefaultCompilerOptions()
  }
}
