/**
 * 通用操作处理器 (Linux)
 * 跨应用操作、连接检测、文档信息等
 * 与 Mac 版同架构（反向轮询桥），平台标记为 linux
 */

registerHandler('ping', function(params) {
    return ok({ message: 'pong', timestamp: new Date().getTime(), platform: 'linux' });
});

registerHandler('wireCheck', function(params) {
    return ok({ message: 'WPS Bridge 已连接', appType: getAppType() });
});

registerHandler('getAppInfo', function(params) {
    return getAppInfoImpl();
});

registerHandler('getSelectedText', function(params) {
    try {
        var sel = Application.Selection;
        if (!sel) return fail('没有选中内容');
        return ok({ text: sel.Text || '', length: (sel.Text || '').length });
    } catch (e) {
        return fail('获取选中文本失败: ' + e.message);
    }
});

registerHandler('setSelectedText', function(params) {
    try {
        var sel = Application.Selection;
        if (!sel) return fail('没有选中的文本范围');
        sel.Text = params.text || '';
        return ok({});
    } catch (e) {
        return fail('设置选中文本失败: ' + e.message);
    }
});

registerHandler('save', function(params) {
    try {
        var doc = getActiveDoc();
        if (!doc) return fail('没有打开的文档');
        doc.Save();
        return ok({});
    } catch (e) {
        return fail('保存失败: ' + e.message);
    }
});

registerHandler('saveAs', function(params) {
    try {
        var doc = getActiveDoc();
        if (!doc) return fail('没有打开的文档');
        var filePath = params.path || params.filePath;
        if (!filePath) return invalidParam('缺少 path');
        doc.SaveAs(filePath);
        return ok({ path: filePath });
    } catch (e) {
        return fail('另存为失败: ' + e.message);
    }
});

registerHandler('openFile', function(params) {
    try {
        var filePath = params.path || params.filePath;
        if (!filePath) return invalidParam('缺少 path');

        var appType = null;
        var lower = filePath.toLowerCase();
        // 正则边界匹配（\.xlsx?$ 等），避免 indexOf('.xls') 误匹配 .xlss/.document 等非标准后缀（与 mac-poll-server 对齐）
        if (/\.xlsx?$/.test(lower)) appType = 'et';
        else if (/\.docx?$/.test(lower)) appType = 'wps';
        else if (/\.pptx?$/.test(lower)) appType = 'wpp';
        else appType = getAppType();

        var app = getWpsApp(appType);
        if (!app) return fail('无法获取 WPS 应用实例');

        // 按 appType 明确选择集合，避免跨应用打开时取错（如文字模式下取 Presentations 打开 xlsx）
        var docs = null;
        if (appType === 'et') docs = app.Workbooks;
        else if (appType === 'wps') docs = app.Documents;
        else if (appType === 'wpp') docs = app.Presentations;
        if (!docs) return fail('当前应用不支持打开文件: ' + appType);
        docs.Open(filePath);
        return ok({ path: filePath });
    } catch (e) {
        return fail('打开文件失败: ' + e.message);
    }
});

registerHandler('convertToPDF', function(params) {
    try {
        var doc = getActiveDoc();
        if (!doc) return fail('没有打开的文档');
        var outputPath = params.outputPath || params.path;
        if (!outputPath) return invalidParam('缺少 outputPath');
        doc.ExportAsFixedFormat(outputPath, 17);
        return ok({ outputPath: outputPath });
    } catch (e) {
        return fail('导出 PDF 失败: ' + e.message);
    }
});

registerHandler('getDocumentStats', function(params) {
    try {
        var doc = getActiveDoc();
        if (!doc) return fail('没有打开的文档');
        return ok({
            name: doc.Name,
            path: doc.FullName,
            paragraphCount: doc.Paragraphs ? doc.Paragraphs.Count : 0,
            wordCount: doc.Words ? doc.Words.Count : 0,
            characterCount: doc.Characters ? doc.Characters.Count : 0
        });
    } catch (e) {
        return fail('获取文档统计失败: ' + e.message);
    }
});

function getAppType() {
    try {
        if (typeof Application === 'undefined') return 'unknown';
        var name = '';
        try { name = Application.Name || ''; } catch (e) {}
        // 大小写不敏感匹配：Linux WPS 的 Application.Name 可能返回小写命令名（wps/et/wpp）
        var lowerName = String(name).toLowerCase();

        if (lowerName.indexOf('表格') !== -1 || lowerName.indexOf('excel') !== -1 || lowerName.indexOf('et') !== -1 || lowerName.indexOf('spreadsheet') !== -1) return 'et';
        if (lowerName.indexOf('演示') !== -1 || lowerName.indexOf('presentation') !== -1 || lowerName.indexOf('wpp') !== -1 || lowerName.indexOf('slide') !== -1) return 'wpp';
        if (lowerName.indexOf('文字') !== -1 || lowerName.indexOf('writer') !== -1 || lowerName.indexOf('word') !== -1 || lowerName.indexOf('wps') !== -1) return 'wps';

        try { if (Application.ActiveDocument) return 'wps'; } catch (e) {}
        try { if (Application.ActiveWorkbook) return 'et'; } catch (e) {}
        try { if (Application.ActivePresentation) return 'wpp'; } catch (e) {}
    } catch (e) {}
    return 'unknown';
}

function getAppInfoImpl() {
    try {
        var appType = getAppType();
        var appName = '';
        try { appName = Application.Name || ''; } catch (e) {}
        return ok({
            appType: appType,
            appName: appName,
            platform: 'linux',
            version: 1
        });
    } catch (e) {
        return ok({ appType: 'unknown', appName: '', platform: 'linux' });
    }
}

function getActiveDoc() {
    try {
        var appType = getAppType();
        if (appType === 'et') return Application.ActiveWorkbook;
        if (appType === 'wps') return Application.ActiveDocument;
        if (appType === 'wpp') return Application.ActivePresentation;
    } catch (e) {}
    return null;
}

function getWpsApp(appType) {
    try {
        if (typeof Application === 'undefined') return null;
        return Application;
    } catch (e) {
        return null;
    }
}
