/**
 * WPS 文字（Word）操作处理器
 * 文档内容读写、格式设置、表格、书签等
 */

// 获取选中区域 Range；无选中时返回 null（供依赖 Selection 的 handler 做明确错误提示）
function getSelectionRange() {
    try {
        if (!Application.Selection) return null;
        return Application.Selection.Range;
    } catch (e) {
        return null;
    }
}

registerHandler('getActiveDocument', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');

        var paraCount = 0, wordCount = 0, charCount = 0;
        try { paraCount = doc.Paragraphs.Count; } catch (e) {}
        try { wordCount = doc.Words.Count; } catch (e) {}
        try { charCount = doc.Characters.Count; } catch (e) {}

        return ok({
            name: doc.Name,
            path: doc.FullName,
            paragraphCount: paraCount,
            wordCount: wordCount,
            characterCount: charCount
        });
    } catch (e) {
        return fail('获取文档信息失败: ' + e.message);
    }
});

registerHandler('getOpenDocuments', function(params) {
    try {
        var docs = Application.Documents;
        var list = [];
        for (var i = 1; i <= docs.Count; i++) {
            var d = docs.Item(i);
            list.push({ name: d.Name, path: d.FullName, index: i });
        }
        return ok({ documents: list });
    } catch (e) {
        return fail('获取文档列表失败: ' + e.message);
    }
});

registerHandler('switchDocument', function(params) {
    try {
        var docs = Application.Documents;
        var target = params.name || params.index;
        var doc = null;

        if (typeof target === 'number') {
            doc = docs.Item(target);
        } else {
            for (var i = 1; i <= docs.Count; i++) {
                if (docs.Item(i).Name === target) {
                    doc = docs.Item(i);
                    break;
                }
            }
        }
        if (!doc) return fail('未找到文档: ' + target);
        doc.Activate();
        return ok({ name: doc.Name });
    } catch (e) {
        return fail('切换文档失败: ' + e.message);
    }
});

registerHandler('openDocument', function(params) {
    try {
        var filePath = params.path || params.filePath;
        if (!filePath) return invalidParam('缺少 path');
        var doc = Application.Documents.Open(filePath);
        return ok({ name: doc.Name, path: doc.FullName });
    } catch (e) {
        return fail('打开文档失败: ' + e.message);
    }
});

registerHandler('createDocument', function(params) {
    try {
        var doc = Application.Documents.Add();
        return ok({ name: doc.Name });
    } catch (e) {
        return fail('创建文档失败: ' + e.message);
    }
});

registerHandler('getDocumentText', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var text = doc.Content.Text;
        var length = text.length;
        // maxLength 显式校验：非法字符串/负数显式 fail（NaN > 0 为 false 会静默不截断，NaN 传入 substring 产生乱码）
        var maxLength = params.maxLength !== undefined ? parseInt(params.maxLength, 10) : 10000;
        if (isNaN(maxLength) || maxLength < 0) return fail('无效的 maxLength: ' + params.maxLength + '（必须为非负整数）');
        var truncated = false;
        // maxLength=0 视为不截断（返回全部）
        if (maxLength > 0 && length > maxLength) {
            text = text.substring(0, maxLength) + '\n...(截断, 共 ' + length + ' 字符)';
            truncated = true;
        }
        // truncated 标记让 AI 知道内容不完整，可请求分段读取或传更大 maxLength
        return ok({ text: text, length: length, truncated: truncated, maxLength: maxLength });
    } catch (e) {
        return fail('获取文档文本失败: ' + e.message);
    }
});

registerHandler('insertText', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        // 缺 text 显式 fail（与 saveAs 缺 path 语义一致），避免 AI 漏传参数静默成功
        if (params.text === undefined || params.text === null) return invalidParam('缺少 text');
        var text = params.text;
        var pos = params.position || 'cursor';

        switch (pos) {
            case 'start':
                doc.Range(0, 0).InsertBefore(text);
                break;
            case 'end':
                var end = doc.Content.End - 1;
                doc.Range(end, end).InsertAfter(text);
                break;
            default:
                Application.Selection.TypeText(text);
        }
        return ok({});
    } catch (e) {
        return fail('插入文本失败: ' + e.message);
    }
});

registerHandler('findReplace', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var find = doc.Content.Find;
        find.ClearFormatting();
        find.Replacement.ClearFormatting();
        // findText 前置校验：避免 undefined 传给 Execute 抛费解错误（与 replaceInSheet 第 17 轮修复对齐，word 侧漏网）
        if (!params.findText) return fail('缺少 findText');
        // 统一通过 Execute 位置参数传查找/替换文本，避免前置赋值 + 位置参数双写（WPS 对 Execute 位置参数敏感，双写行为未定义）
        // replaceAll 严格布尔判断（0/字符串等不再被当 true）
        var replaceType = params.replaceAll === true ? 2 : 1;
        var result = find.Execute(
            params.findText, false, false, false, false, false,
            true, 1, false, params.replaceText || '', replaceType
        );
        // 部分 WPS 版本返回 Find 对象而非 boolean，统一转布尔
        return ok({ replaced: !!result });
    } catch (e) {
        return fail('查找替换失败: ' + e.message);
    }
});

registerHandler('setFont', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var range = (params.range === 'all') ? doc.Content : getSelectionRange();
        if (!range) return fail('请先在文档中选中文本或设置光标');
        if (params.fontName) range.Font.Name = params.fontName;
        if (params.fontSize) range.Font.Size = params.fontSize;
        if (params.bold !== undefined) range.Font.Bold = params.bold;
        if (params.italic !== undefined) range.Font.Italic = params.italic;
        if (params.color !== undefined) {
            var fc = parseColor(params.color);
            if (fc === null) return fail('无效的颜色值: ' + params.color + '，支持的格式: #FF0000, FF0000, red, blue 等');
            range.Font.Color = fc;
        }
        if (params.underline !== undefined) range.Font.Underline = params.underline;
        return ok({});
    } catch (e) {
        return fail('设置字体失败: ' + e.message);
    }
});

registerHandler('applyStyle', function(params) {
    try {
        var range = getSelectionRange();
        if (!range) return fail('请先在文档中选中文本');
        range.Style = params.styleName;
        return ok({});
    } catch (e) {
        return fail('应用样式失败: ' + e.message);
    }
});

registerHandler('insertTable', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        // 显式整数校验：rows/cols 必须为正整数（与 excel/ppt 侧语义对齐），避免 rows:0/"0" 静默兜底为 3
        var rows = parseInt(params.rows, 10);
        if (isNaN(rows) || rows < 1) return fail('无效的行数: ' + params.rows + '（必须为正整数）');
        var cols = parseInt(params.cols, 10);
        if (isNaN(cols) || cols < 1) return fail('无效的列数: ' + params.cols + '（必须为正整数）');
        var table = doc.Tables.Add(Application.Selection.Range, rows, cols);

        if (params.data && Array.isArray(params.data)) {
            for (var r = 0; r < Math.min(params.data.length, rows); r++) {
                var rowData = params.data[r];
                if (Array.isArray(rowData)) {
                    for (var c = 0; c < Math.min(rowData.length, cols); c++) {
                        table.Cell(r + 1, c + 1).Range.Text = String(rowData[c]);
                    }
                }
            }
        }
        table.Borders.Enable = true;
        return ok({ rows: rows, cols: cols });
    } catch (e) {
        return fail('插入表格失败: ' + e.message);
    }
});

registerHandler('generateTOC', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var range = doc.Range(0, 0);
        doc.TablesOfContents.Add(range);
        return ok({});
    } catch (e) {
        return fail('生成目录失败: ' + e.message);
    }
});

registerHandler('insertPageBreak', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        doc.Content.InsertBreak(7);
        return ok({});
    } catch (e) {
        return fail('插入分页符失败: ' + e.message);
    }
});

registerHandler('insertImage', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var filePath = params.path || params.imagePath;
        if (!filePath) return invalidParam('缺少 path');
        var inlineShape = doc.InlineShapes.AddPicture(filePath);
        if (params.width) inlineShape.Width = params.width;
        if (params.height) inlineShape.Height = params.height;
        return ok({});
    } catch (e) {
        return fail('插入图片失败: ' + e.message);
    }
});

registerHandler('insertHyperlink', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        doc.Hyperlinks.Add(Application.Selection.Range, params.url, '', '', params.text || params.url);
        return ok({});
    } catch (e) {
        return fail('插入超链接失败: ' + e.message);
    }
});

registerHandler('insertBookmark', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        doc.Bookmarks.Add(params.name, Application.Selection.Range);
        return ok({});
    } catch (e) {
        return fail('插入书签失败: ' + e.message);
    }
});

registerHandler('getBookmarks', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var list = [];
        for (var i = 1; i <= doc.Bookmarks.Count; i++) {
            list.push(doc.Bookmarks.Item(i).Name);
        }
        return ok({ bookmarks: list });
    } catch (e) {
        return fail('获取书签失败: ' + e.message);
    }
});

registerHandler('addComment', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var comment = doc.Comments.Add(Application.Selection.Range, params.text || '');
        return ok({});
    } catch (e) {
        return fail('添加批注失败: ' + e.message);
    }
});

registerHandler('getComments', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var list = [];
        for (var i = 1; i <= doc.Comments.Count; i++) {
            var c = doc.Comments.Item(i);
            list.push({ author: c.Author || '', text: c.Text, date: c.Date });
        }
        return ok({ comments: list });
    } catch (e) {
        return fail('获取批注失败: ' + e.message);
    }
});

registerHandler('insertHeader', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        doc.Sections.Item(1).Headers.Item(1).Range.Text = params.text || '';
        return ok({});
    } catch (e) {
        return fail('插入页眉失败: ' + e.message);
    }
});

registerHandler('insertFooter', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        doc.Sections.Item(1).Footers.Item(1).Range.Text = params.text || '';
        return ok({});
    } catch (e) {
        return fail('插入页脚失败: ' + e.message);
    }
});

registerHandler('setPageSetup', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var ps = doc.PageSetup;
        // wdOrientation: wdOrientPortrait=0, wdOrientLandscape=1（0 是合法 portrait 值，不能用真值判断）
        if (params.orientation !== undefined) {
            ps.Orientation = params.orientation === 'landscape' ? 1 : 0;
        }
        if (params.topMargin !== undefined) ps.TopMargin = params.topMargin;
        if (params.bottomMargin !== undefined) ps.BottomMargin = params.bottomMargin;
        if (params.leftMargin !== undefined) ps.LeftMargin = params.leftMargin;
        if (params.rightMargin !== undefined) ps.RightMargin = params.rightMargin;
        if (params.pageWidth !== undefined) ps.PageWidth = params.pageWidth;
        if (params.pageHeight !== undefined) ps.PageHeight = params.pageHeight;
        return ok({});
    } catch (e) {
        return fail('设置页面失败: ' + e.message);
    }
});

registerHandler('setParagraph', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var range = (params.range === 'all') ? doc.Content : getSelectionRange();
        if (!range) return fail('请先在文档中选中文本或设置光标');
        var para = range.ParagraphFormat;
        if (params.alignment !== undefined) para.Alignment = params.alignment;
        if (params.lineSpacing) para.LineSpacing = params.lineSpacing;
        if (params.spaceBefore !== undefined) para.SpaceBefore = params.spaceBefore;
        if (params.spaceAfter !== undefined) para.SpaceAfter = params.spaceAfter;
        if (params.firstLineIndent !== undefined) para.FirstLineIndent = params.firstLineIndent;
        return ok({});
    } catch (e) {
        return fail('设置段落格式失败: ' + e.message);
    }
});

function toBgr(rgb) {
    return ((rgb & 0xFF) << 16) | (rgb & 0xFF00) | ((rgb >> 16) & 0xFF);
}

var COLOR_NAMES = {
    red: toBgr(0xFF0000), green: toBgr(0x00FF00), blue: toBgr(0x0000FF), yellow: toBgr(0xFFFF00),
    cyan: toBgr(0x00FFFF), magenta: toBgr(0xFF00FF), white: toBgr(0xFFFFFF), black: toBgr(0x000000),
    gray: toBgr(0x808080), grey: toBgr(0x808080), orange: toBgr(0xFFA500), purple: toBgr(0x800080),
    pink: toBgr(0xFFC0CB), brown: toBgr(0xA52A2A), navy: toBgr(0x000080), teal: toBgr(0x008080),
    maroon: toBgr(0x800000), lime: toBgr(0x00FF00), silver: toBgr(0xC0C0C0), gold: toBgr(0xFFD700)
};

// 统一颜色解析：支持颜色名 / #RRGGBB / RRGGBB / 数字（BGR），非法返回 null
function parseColor(color) {
    if (typeof color === 'number') return color;
    if (typeof color !== 'string' || !color) return null;
    var lower = color.toLowerCase();
    if (COLOR_NAMES[lower] !== undefined) return COLOR_NAMES[lower];
    var hexStr = color.indexOf('#') === 0 ? color.substring(1) : color;
    if (!/^[0-9a-fA-F]{6}$/.test(hexStr)) return null;
    return toBgr(parseInt(hexStr, 16));
}

registerHandler('setTextColor', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var range = getSelectionRange();
        if (!range) return fail('请先在文档中选中文本');
        var color = parseColor(params.color);
        if (color === null) return fail('无效的颜色值: ' + params.color + '，支持的格式: #FF0000, FF0000, red, blue 等');
        range.Font.Color = color;
        return ok({});
    } catch (e) {
        return fail('设置文字颜色失败: ' + e.message);
    }
});

registerHandler('insertSectionBreak', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var breakType = params.breakType || 'nextPage';
        var typeMap = { nextPage: 2, continuous: 3, evenPage: 4, oddPage: 5 };
        var type = typeMap[breakType] || 2;
        Application.Selection.InsertBreak(type);
        return ok({});
    } catch (e) {
        return fail('插入分节符失败: ' + e.message);
    }
});

registerHandler('setLineSpacing', function(params) {
    try {
        var doc = Application.ActiveDocument;
        if (!doc) return fail('没有打开的文档');
        var lineSpacing = params.lineSpacing;
        if (lineSpacing === undefined || lineSpacing <= 0) return fail('行距值必须为正数');
        var range;
        if (params.paragraphIndex !== undefined) {
            var paraIdx = parseInt(params.paragraphIndex);
            if (isNaN(paraIdx) || paraIdx < 0 || paraIdx >= doc.Paragraphs.Count) return fail('段落索引超出范围');
            range = doc.Paragraphs.Item(paraIdx + 1).Range;
        } else {
            range = getSelectionRange();
            if (!range) return fail('请先在文档中选中文本或设置光标');
        }
        range.ParagraphFormat.LineSpacingRule = 5;
        range.ParagraphFormat.LineSpacing = lineSpacing;
        return ok({});
    } catch (e) {
        return fail('设置行距失败: ' + e.message);
    }
});
