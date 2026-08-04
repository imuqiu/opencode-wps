/**
 * WPS 演示（PPT）操作处理器
 * 演示文稿、幻灯片、形状、文本框、动画、切换效果等
 */

var COLOR_SCHEMES = {
    business: { title: 0x2F5496, body: 0x333333, accent: 0x4472C4 },
    tech: { title: 0x00B0F0, body: 0x404040, accent: 0x0078D7 },
    creative: { title: 0xFF6B6B, body: 0x4A4A4A, accent: 0xE74856 },
    minimal: { title: 0x000000, body: 0x666666, accent: 0x999999 }
};

function getPPT() {
    return Application.ActivePresentation;
}

// 将颜色参数解析为整型 RGB：支持 #RRGGBB、RRGGBB、RGB 简写；数字直接返回；非法返回 null
// （与 excel-handler 的 toExcelColor 语义对称，供 PPT COM 的 ForeColor.RGB 赋值使用）
function toRgb(color) {
    if (typeof color === 'number') return color;
    if (typeof color !== 'string') return null;
    var hex = color.trim();
    if (hex.charAt(0) === '#') hex = hex.substring(1);
    if (hex.length === 3) {
        hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return parseInt(hex, 16);
}

registerHandler('getActivePresentation', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');

        var slides = [];
        for (var i = 1; i <= pres.Slides.Count; i++) {
            var slide = pres.Slides.Item(i);
            var shapes = [];
            for (var j = 1; j <= slide.Shapes.Count; j++) {
                var shape = slide.Shapes.Item(j);
                var text = '';
                try {
                    if (shape.HasTextFrame && shape.TextFrame.HasText) {
                        text = shape.TextFrame.TextRange.Text;
                        if (text.length > 50) text = text.substring(0, 50) + '...';
                    }
                } catch (e) {}
                shapes.push({ name: shape.Name, type: shape.Type, text: text });
            }
            slides.push({ index: i, shapeCount: slide.Shapes.Count, shapes: shapes });
        }

        return ok({
            name: pres.Name,
            path: pres.FullName,
            slideCount: pres.Slides.Count,
            slides: slides
        });
    } catch (e) {
        return fail('获取演示文稿信息失败: ' + e.message);
    }
});

registerHandler('getOpenPresentations', function(params) {
    try {
        var preses = Application.Presentations;
        var list = [];
        for (var i = 1; i <= preses.Count; i++) {
            var p = preses.Item(i);
            list.push({ name: p.Name, path: p.FullName, index: i, slideCount: p.Slides.Count });
        }
        return ok({ presentations: list });
    } catch (e) {
        return fail('获取演示文稿列表失败: ' + e.message);
    }
});

registerHandler('switchPresentation', function(params) {
    try {
        var preses = Application.Presentations;
        var target = params.name || params.index;
        var found = null;
        if (typeof target === 'number') {
            found = preses.Item(target);
        } else {
            for (var i = 1; i <= preses.Count; i++) {
                if (preses.Item(i).Name === target) { found = preses.Item(i); break; }
            }
        }
        if (!found) return fail('未找到演示文稿: ' + target);
        found.Activate();
        return ok({ name: found.Name });
    } catch (e) {
        return fail('切换演示文稿失败: ' + e.message);
    }
});

registerHandler('openPresentation', function(params) {
    try {
        var filePath = params.path || params.filePath;
        if (!filePath) return invalidParam('缺少 path');
        var pres = Application.Presentations.Open(filePath);
        return ok({ name: pres.Name, path: pres.FullName });
    } catch (e) {
        return fail('打开演示文稿失败: ' + e.message);
    }
});

registerHandler('createPresentation', function(params) {
    try {
        var pres = Application.Presentations.Add();
        return ok({ name: pres.Name });
    } catch (e) {
        return fail('创建演示文稿失败: ' + e.message);
    }
});

registerHandler('closePresentation', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        pres.Close();
        return ok({});
    } catch (e) {
        return fail('关闭演示文稿失败: ' + e.message);
    }
});

registerHandler('addSlide', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var layouts = { title: 1, title_content: 2, blank: 12, two_column: 3 };
        var layoutType = layouts[params.layout] || 2;
        var position = params.position || (pres.Slides.Count + 1);
        var slide = pres.Slides.Add(position, layoutType);
        if (params.title && slide.Shapes.HasTitle) {
            slide.Shapes.Title.TextFrame.TextRange.Text = params.title;
        }
        return ok({ slideIndex: position });
    } catch (e) {
        return fail('添加幻灯片失败: ' + e.message);
    }
});

registerHandler('deleteSlide', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || params.index || 1;
        pres.Slides.Item(idx).Delete();
        return ok({});
    } catch (e) {
        return fail('删除幻灯片失败: ' + e.message);
    }
});

registerHandler('duplicateSlide', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        pres.Slides.Item(idx).Duplicate();
        return ok({});
    } catch (e) {
        return fail('复制幻灯片失败: ' + e.message);
    }
});

registerHandler('moveSlide', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        pres.Slides.Item(params.slideIndex).MoveTo(params.targetIndex);
        return ok({});
    } catch (e) {
        return fail('移动幻灯片失败: ' + e.message);
    }
});

registerHandler('getSlideCount', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        return ok({ count: pres.Slides.Count });
    } catch (e) {
        return fail('获取幻灯片数量失败: ' + e.message);
    }
});

registerHandler('getSlideInfo', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || params.index || 1;
        var slide = pres.Slides.Item(idx);
        var shapes = [];
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            shapes.push({ name: s.Name, type: s.Type, left: s.Left, top: s.Top, width: s.Width, height: s.Height });
        }
        return ok({ index: idx, shapeCount: slide.Shapes.Count, shapes: shapes });
    } catch (e) {
        return fail('获取幻灯片信息失败: ' + e.message);
    }
});

registerHandler('switchSlide', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || params.index || 1;
        pres.Slides.Item(idx).Select();
        return ok({ slideIndex: idx });
    } catch (e) {
        return fail('切换幻灯片失败: ' + e.message);
    }
});

registerHandler('getSlideTitle', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var title = '';
        if (slide.Shapes.HasTitle) {
            title = slide.Shapes.Title.TextFrame.TextRange.Text;
        }
        return ok({ slideIndex: idx, title: title });
    } catch (e) {
        return fail('获取幻灯片标题失败: ' + e.message);
    }
});

registerHandler('setSlideTitle', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var slide = pres.Slides.Item(params.slideIndex);
        if (slide.Shapes.HasTitle) {
            slide.Shapes.Title.TextFrame.TextRange.Text = params.title;
        }
        return ok({});
    } catch (e) {
        return fail('设置幻灯片标题失败: ' + e.message);
    }
});

registerHandler('setSlideSubtitle', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var slide = pres.Slides.Item(params.slideIndex);
        // 按副标题占位符类型（ppPlaceholderSubtitle=15）定位，避免用 t.length<100 猜文本误覆盖标题/正文
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (!s.HasTextFrame) continue;
            try {
                var pf = s.PlaceholderFormat;
                if (pf && pf.Type === 15) {
                    s.TextFrame.TextRange.Text = params.subtitle;
                    return ok({});
                }
            } catch (e) {}
        }
        return fail('未找到副标题占位符');
    } catch (e) {
        return fail('设置幻灯片副标题失败: ' + e.message);
    }
});

registerHandler('setSlideContent', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var slide = pres.Slides.Item(params.slideIndex);
        var count = 0;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (!s.HasTextFrame) continue;
            // 跳过标题占位符（ppPlaceholderTitle=13 / ppPlaceholderCenterTitle=14），
            // 不能用 j===1 序号判断（标题形状不一定在索引 1）
            try {
                var pf = s.PlaceholderFormat;
                if (pf && (pf.Type === 13 || pf.Type === 14)) continue;
            } catch (e) {}
            if (s.TextFrame.TextRange.Text) {
                s.TextFrame.TextRange.Text = params.content || '';
                count++;
                break;
            }
        }
        return ok({ updated: count > 0 });
    } catch (e) {
        return fail('设置幻灯片内容失败: ' + e.message);
    }
});

registerHandler('addTextBox', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || Application.ActiveWindow.Selection.SlideRange.SlideIndex;
        var slide = pres.Slides.Item(idx);
        var shape = slide.Shapes.AddTextbox(1, params.left || 100, params.top || 100, params.width || 400, params.height || 50);
        shape.TextFrame.TextRange.Text = params.text || '';
        if (params.fontSize) shape.TextFrame.TextRange.Font.Size = params.fontSize;
        if (params.fontName) shape.TextFrame.TextRange.Font.Name = params.fontName;
        return ok({ shapeName: shape.Name });
    } catch (e) {
        return fail('添加文本框失败: ' + e.message);
    }
});

registerHandler('deleteTextBox', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var shapeName = params.shapeName || params.name;
        var slide = pres.Slides.Item(idx);
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Name === shapeName) {
                slide.Shapes.Item(j).Delete();
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('删除文本框失败: ' + e.message);
    }
});

registerHandler('getTextBoxes', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var boxes = [];
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.HasTextFrame) {
                boxes.push({ name: s.Name, text: s.TextFrame.TextRange.Text });
            }
        }
        return ok({ textBoxes: boxes });
    } catch (e) {
        return fail('获取文本框列表失败: ' + e.message);
    }
});

registerHandler('setTextBoxText', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Name === shapeName) {
                slide.Shapes.Item(j).TextFrame.TextRange.Text = params.text || '';
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置文本框文本失败: ' + e.message);
    }
});

registerHandler('setTextBoxStyle', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName && s.HasTextFrame) {
                var tr = s.TextFrame.TextRange;
                if (params.fontName) tr.Font.Name = params.fontName;
                if (params.fontSize) tr.Font.Size = params.fontSize;
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置文本框样式失败: ' + e.message);
    }
});

registerHandler('addShape', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeTypes = { rectangle: 1, oval: 9, line: 6, arrow: 13, diamond: 4, triangle: 5 };
        var st = shapeTypes[params.shapeType] || 1;
        var shape = slide.Shapes.AddShape(st, params.left || 100, params.top || 100, params.width || 100, params.height || 100);
        if (params.text) {
            shape.TextFrame.TextRange.Text = params.text;
        }
        return ok({ shapeName: shape.Name });
    } catch (e) {
        return fail('添加形状失败: ' + e.message);
    }
});

registerHandler('deleteShape', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Name === shapeName) {
                slide.Shapes.Item(j).Delete();
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('删除形状失败: ' + e.message);
    }
});

registerHandler('getShapes', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapes = [];
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            shapes.push({ name: s.Name, type: s.Type, left: s.Left, top: s.Top, width: s.Width, height: s.Height });
        }
        return ok({ shapes: shapes });
    } catch (e) {
        return fail('获取形状列表失败: ' + e.message);
    }
});

registerHandler('setShapeText', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Name === shapeName) {
                slide.Shapes.Item(j).TextFrame.TextRange.Text = params.text || '';
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置形状文本失败: ' + e.message);
    }
});

registerHandler('setShapePosition', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName) {
                if (params.left !== undefined) s.Left = params.left;
                if (params.top !== undefined) s.Top = params.top;
                if (params.width !== undefined) s.Width = params.width;
                if (params.height !== undefined) s.Height = params.height;
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置形状位置失败: ' + e.message);
    }
});

registerHandler('setShapeStyle', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName) {
                if (params.fillColor) {
                    var fc = toRgb(params.fillColor);
                    if (fc === null) return fail('无效的填充颜色: ' + params.fillColor);
                    s.Fill.ForeColor.RGB = fc;
                    if (!s.Fill.Visible) s.Fill.Visible = 1;
                }
                if (params.lineColor) {
                    var lc = toRgb(params.lineColor);
                    if (lc === null) return fail('无效的线条颜色: ' + params.lineColor);
                    s.Line.ForeColor.RGB = lc;
                }
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置形状样式失败: ' + e.message);
    }
});

registerHandler('setShapeBorder', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName) {
                s.Line.Visible = 1;
                if (params.color) {
                    var lc = toRgb(params.color);
                    if (lc === null) return fail('无效的边框颜色: ' + params.color);
                    s.Line.ForeColor.RGB = lc;
                }
                if (params.weight) s.Line.Weight = params.weight;
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置形状边框失败: ' + e.message);
    }
});

registerHandler('setShapeShadow', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName) {
                s.Shadow.Visible = params.visible !== false ? 1 : 0;
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置形状阴影失败: ' + e.message);
    }
});

registerHandler('setShapeTransparency', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName) {
                s.Fill.Transparency = params.transparency || 0;
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置形状透明度失败: ' + e.message);
    }
});

registerHandler('setShapeZOrder', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName) {
                var cmd = params.command || 'forward';
                if (cmd === 'forward' || cmd === 'up') s.ZOrder(1);
                else if (cmd === 'backward' || cmd === 'down') s.ZOrder(2);
                else if (cmd === 'front' || cmd === 'top') s.ZOrder(0);
                else if (cmd === 'bottom' || cmd === 'back') s.ZOrder(3);
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置形状层级失败: ' + e.message);
    }
});

registerHandler('groupShapes', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var names = params.shapeNames || [];
        if (names.length < 2) return fail('至少需要两个形状');
        var range = slide.Shapes.Range(names);
        var group = range.Group();
        return ok({ groupName: group.Name });
    } catch (e) {
        return fail('组合形状失败: ' + e.message);
    }
});

registerHandler('duplicateShape', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Name === shapeName) {
                var dup = slide.Shapes.Item(j).Duplicate();
                return ok({ shapeName: dup.Name });
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('复制形状失败: ' + e.message);
    }
});

registerHandler('alignShapes', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var names = params.shapeNames || [];
        if (names.length < 2) return fail('至少需要两个形状');
        var range = slide.Shapes.Range(names);
        var align = params.align || 'left';
        var map = { left: 0, center: 1, right: 2, top: 3, middle: 4, bottom: 5 };
        range.Align(map[align] || 0, 0);
        return ok({});
    } catch (e) {
        return fail('对齐形状失败: ' + e.message);
    }
});

registerHandler('distributeShapes', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var names = params.shapeNames || [];
        if (names.length < 2) return fail('至少需要两个形状');
        var range = slide.Shapes.Range(names);
        if (params.direction === 'horizontal') range.Distribute(0, 0);
        else range.Distribute(1, 0);
        return ok({});
    } catch (e) {
        return fail('分布形状失败: ' + e.message);
    }
});

registerHandler('smartDistribute', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var names = params.shapeNames || [];
        if (names.length < 2) return fail('至少需要两个形状');
        var range = slide.Shapes.Range(names);
        range.Align(1, 0);
        range.Distribute(0, 0);
        return ok({});
    } catch (e) {
        return fail('智能分布失败: ' + e.message);
    }
});

registerHandler('setSlideBackground', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        if (params.color !== undefined) {
            slide.FollowMasterBackground = 0;
            var bg = toRgb(params.color);
            if (bg === null) return fail('无效的背景颜色: ' + params.color);
            slide.Background.Fill.ForeColor.RGB = bg;
            slide.Background.Fill.Visible = 1;
        }
        if (params.imagePath || params.path) {
            var img = params.imagePath || params.path;
            slide.FollowMasterBackground = 0;
            slide.Background.Fill.UserPicture(img);
        }
        return ok({});
    } catch (e) {
        return fail('设置幻灯片背景失败: ' + e.message);
    }
});

registerHandler('setSlideLayout', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var slide = pres.Slides.Item(params.slideIndex);
        var layouts = { title: 1, title_content: 2, blank: 12, two_column: 3 };
        var lt = layouts[params.layout] || 2;
        slide.Layout = lt;
        return ok({});
    } catch (e) {
        return fail('设置幻灯片布局失败: ' + e.message);
    }
});

registerHandler('setSlideNumber', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        slide.HeadersFooters.SlideNumber.Visible = 1;
        return ok({});
    } catch (e) {
        return fail('设置幻灯片编号失败: ' + e.message);
    }
});

registerHandler('setSlideTransition', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var types = { fade: 1, push: 2, wipe: 3, split: 4, uncover: 5, cover: 6, zoom: 31 };
        slide.SlideShowTransition.EntryEffect = types[params.type] || 1;
        if (params.speed) {
            slide.SlideShowTransition.Speed = params.speed === 'slow' ? 3 : (params.speed === 'fast' ? 1 : 2);
        }
        return ok({});
    } catch (e) {
        return fail('设置幻灯片切换效果失败: ' + e.message);
    }
});

registerHandler('removeSlideTransition', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        pres.Slides.Item(idx).SlideShowTransition.EntryEffect = 0;
        return ok({});
    } catch (e) {
        return fail('移除幻灯片切换效果失败: ' + e.message);
    }
});

registerHandler('applyTransitionToAll', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var types = { fade: 1, push: 2, wipe: 3, split: 4, uncover: 5, cover: 6, zoom: 31 };
        var transitionType = types[params.type] || 1;
        for (var i = 1; i <= pres.Slides.Count; i++) {
            pres.Slides.Item(i).SlideShowTransition.EntryEffect = transitionType;
        }
        return ok({});
    } catch (e) {
        return fail('应用全局切换效果失败: ' + e.message);
    }
});

registerHandler('addAnimation', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Name === shapeName) {
                var effectTypes = { fade: 0, flyIn: 1, zoomIn: 64, wipe: 15 };
                var etype = effectTypes[params.animationType || 'fade'] || 0;
                slide.TimeLine.MainSequence.AddEffect(slide.Shapes.Item(j), 0, 0, etype);
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('添加动画失败: ' + e.message);
    }
});

registerHandler('removeAnimation', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        while (slide.TimeLine.MainSequence.Count > 0) {
            slide.TimeLine.MainSequence.Item(1).Delete();
        }
        return ok({});
    } catch (e) {
        return fail('移除动画失败: ' + e.message);
    }
});

registerHandler('startSlideShow', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        pres.SlideShowSettings.Run();
        return ok({});
    } catch (e) {
        return fail('开始放映失败: ' + e.message);
    }
});

registerHandler('endSlideShow', function(params) {
    try {
        Application.SlideShowWindows.Item(1).View.Exit();
        return ok({});
    } catch (e) {
        return fail('结束放映失败: ' + e.message);
    }
});

registerHandler('insertPptImage', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var filePath = params.path || params.imagePath;
        if (!filePath) return invalidParam('缺少 path');
        var pic = slide.Shapes.AddPicture(filePath, false, true, params.left || 0, params.top || 0, params.width || -1, params.height || -1);
        return ok({ name: pic.Name });
    } catch (e) {
        return fail('插入图片失败: ' + e.message);
    }
});

registerHandler('deletePptImage', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Name === shapeName) {
                slide.Shapes.Item(j).Delete();
                return ok({});
            }
        }
        return fail('未找到图片形状: ' + shapeName);
    } catch (e) {
        return fail('删除图片失败: ' + e.message);
    }
});

registerHandler('insertPptTable', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var rows = params.rows || 3;
        var cols = params.cols || 3;
        var table = slide.Shapes.AddTable(rows, cols, params.left || 100, params.top || 100, params.width || 400, params.height || 200);
        if (params.data) {
            for (var r = 0; r < Math.min(params.data.length, rows); r++) {
                for (var c = 0; c < Math.min(params.data[r].length, cols); c++) {
                    table.Table.Cell(r + 1, c + 1).Shape.TextFrame.TextRange.Text = String(params.data[r][c]);
                }
            }
        }
        return ok({});
    } catch (e) {
        return fail('插入表格失败: ' + e.message);
    }
});

// 在指定幻灯片中按名称或序号（第 N 个表格）定位表格形状；非表格返回 null
function findPptTable(slide, tableNameOrIndex) {
    if (typeof tableNameOrIndex === 'number') {
        // 按"第 N 个表格"定位
        var n = 0;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.HasTable) {
                n++;
                if (n === tableNameOrIndex) return s;
            }
        }
        return null;
    }
    if (tableNameOrIndex == null) {
        // 默认取第一个表格
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).HasTable) return slide.Shapes.Item(j);
        }
        return null;
    }
    // 按名称精确匹配
    for (var j = 1; j <= slide.Shapes.Count; j++) {
        var s = slide.Shapes.Item(j);
        if (s.Name === tableNameOrIndex && s.HasTable) return s;
    }
    return null;
}

registerHandler('getPptTableCell', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var slide = pres.Slides.Item(params.slideIndex);
        var table = findPptTable(slide, params.tableName !== undefined ? params.tableName : (params.tableIndex || 1));
        if (!table) return fail('未找到表格形状（需为表格且名称/序号匹配）');
        var cell = table.Table.Cell(params.row, params.col);
        return ok({ text: cell.Shape.TextFrame.TextRange.Text });
    } catch (e) {
        return fail('获取表格单元格失败: ' + e.message);
    }
});

registerHandler('setPptTableCell', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var slide = pres.Slides.Item(params.slideIndex);
        var table = findPptTable(slide, params.tableName !== undefined ? params.tableName : (params.tableIndex || 1));
        if (!table) return fail('未找到表格形状（需为表格且名称/序号匹配）');
        table.Table.Cell(params.row, params.col).Shape.TextFrame.TextRange.Text = params.text || '';
        return ok({});
    } catch (e) {
        return fail('设置表格单元格失败: ' + e.message);
    }
});

registerHandler('unifyFont', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        // Linux 默认字体：思源黑体（主流发行版预装）；调用方可显式传 fontName 覆盖
        var fontName = params.fontName || 'Noto Sans CJK SC';
        var count = 0;
        for (var i = 1; i <= pres.Slides.Count; i++) {
            var slide = pres.Slides.Item(i);
            for (var j = 1; j <= slide.Shapes.Count; j++) {
                try {
                    var s = slide.Shapes.Item(j);
                    if (s.HasTextFrame && s.TextFrame.HasText) {
                        s.TextFrame.TextRange.Font.Name = fontName;
                        count++;
                    }
                } catch (e) {}
            }
        }
        return ok({ fontName: fontName, count: count });
    } catch (e) {
        return fail('统一字体失败: ' + e.message);
    }
});

registerHandler('beautifySlide', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || Application.ActiveWindow.Selection.SlideRange.SlideIndex;
        var slide = pres.Slides.Item(idx);
        var scheme = COLOR_SCHEMES[params.style] || COLOR_SCHEMES.business;
        var count = 0;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            try {
                var s = slide.Shapes.Item(j);
                if (s.HasTextFrame && s.TextFrame.HasText) {
                    var tr = s.TextFrame.TextRange;
                    if (tr.Font.Size >= 24) tr.Font.Color.RGB = scheme.title;
                    else tr.Font.Color.RGB = scheme.body;
                    count++;
                }
            } catch (e) {}
        }
        return ok({ style: params.style || 'business', count: count });
    } catch (e) {
        return fail('美化幻灯片失败: ' + e.message);
    }
});

registerHandler('autoBeautifySlide', function(params) {
    return beautifySlideImpl(params);
});

registerHandler('beautifyAllSlides', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var scheme = COLOR_SCHEMES[params.style] || COLOR_SCHEMES.business;
        var total = 0;
        for (var i = 1; i <= pres.Slides.Count; i++) {
            var slide = pres.Slides.Item(i);
            for (var j = 1; j <= slide.Shapes.Count; j++) {
                try {
                    var s = slide.Shapes.Item(j);
                    if (s.HasTextFrame && s.TextFrame.HasText) {
                        var tr = s.TextFrame.TextRange;
                        if (tr.Font.Size >= 24) tr.Font.Color.RGB = scheme.title;
                        else tr.Font.Color.RGB = scheme.body;
                        total++;
                    }
                } catch (e) {}
            }
        }
        return ok({ style: params.style || 'business', total: total });
    } catch (e) {
        return fail('全局美化失败: ' + e.message);
    }
});

function beautifySlideImpl(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || Application.ActiveWindow.Selection.SlideRange.SlideIndex;
        var slide = pres.Slides.Item(idx);
        var scheme = COLOR_SCHEMES[params.style] || COLOR_SCHEMES.business;
        var count = 0;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            try {
                var s = slide.Shapes.Item(j);
                if (s.HasTextFrame && s.TextFrame.HasText) {
                    if (s.TextFrame.TextRange.Font.Size >= 24) s.TextFrame.TextRange.Font.Color.RGB = scheme.title;
                    else s.TextFrame.TextRange.Font.Color.RGB = scheme.body;
                    count++;
                }
            } catch (e) {}
        }
        return ok({ style: params.style || 'business', count: count });
    } catch (e) {
        return fail('自动美化失败: ' + e.message);
    }
}

registerHandler('autoLayout', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var totalW = 0, count = 0;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Width > 50) {
                totalW += slide.Shapes.Item(j).Width;
                count++;
            }
        }
        // 空白幻灯片（无有效形状）直接返回，避免 Shapes.Item(1) 越界
        if (count === 0) return ok({ layouted: 0 });
        var spacing = (slide.Shapes.Item(1).Width - totalW) / (count + 1);
        if (spacing < 10) spacing = 10;
        var curX = spacing;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Width > 50) {
                slide.Shapes.Item(j).Left = curX;
                curX += slide.Shapes.Item(j).Width + spacing;
            }
        }
        return ok({});
    } catch (e) {
        return fail('自动布局失败: ' + e.message);
    }
});

registerHandler('addArrow', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var startX = params.startX || 100;
        var startY = params.startY || 100;
        var endX = params.endX !== undefined ? params.endX : 200;
        var endY = params.endY !== undefined ? params.endY : 100;
        var width = Math.abs(endX - startX) || 100;
        var height = Math.abs(endY - startY) || 20;
        var shape = slide.Shapes.AddShape(33, Math.min(startX, endX), Math.min(startY, endY), width, height);
        return ok({ shapeName: shape.Name });
    } catch (e) {
        return fail('添加箭头失败: ' + e.message);
    }
});

registerHandler('addConnector', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shape = slide.Shapes.AddConnector(1, params.startX || 100, params.startY || 100, params.endX || 300, params.endY || 100);
        return ok({ shapeName: shape.Name });
    } catch (e) {
        return fail('添加连接线失败: ' + e.message);
    }
});

registerHandler('addPptHyperlink', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Name === shapeName) {
                slide.Shapes.Item(j).ActionSettings.Item(1).Hyperlink.Address = params.url;
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('添加超链接失败: ' + e.message);
    }
});

registerHandler('removePptHyperlink', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            if (slide.Shapes.Item(j).Name === shapeName) {
                slide.Shapes.Item(j).ActionSettings.Item(1).Hyperlink.Delete();
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('移除超链接失败: ' + e.message);
    }
});

registerHandler('findPptText', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var query = params.query || params.text;
        if (!query) return invalidParam('缺少 query');
        var results = [];
        for (var i = 1; i <= pres.Slides.Count; i++) {
            var slide = pres.Slides.Item(i);
            for (var j = 1; j <= slide.Shapes.Count; j++) {
                try {
                    var s = slide.Shapes.Item(j);
                    if (s.HasTextFrame && s.TextFrame.HasText) {
                        var t = s.TextFrame.TextRange.Text;
                        if (t.indexOf(query) !== -1) {
                            results.push({ slideIndex: i, shapeName: s.Name, text: t.substring(0, 100) });
                        }
                    }
                } catch (e) {}
            }
        }
        return ok({ query: query, results: results, count: results.length });
    } catch (e) {
        return fail('查找失败: ' + e.message);
    }
});

registerHandler('replacePptText', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var count = 0;
        for (var i = 1; i <= pres.Slides.Count; i++) {
            var slide = pres.Slides.Item(i);
            for (var j = 1; j <= slide.Shapes.Count; j++) {
                try {
                    var s = slide.Shapes.Item(j);
                    if (s.HasTextFrame && s.TextFrame.HasText) {
                        var tr = s.TextFrame.TextRange;
                        if (tr.Text.indexOf(params.findText) !== -1) {
                            tr.Text = tr.Text.replace(new RegExp(params.findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), params.replaceText || '');
                            count++;
                        }
                    }
                } catch (e) {}
            }
        }
        return ok({ count: count });
    } catch (e) {
        return fail('替换文本失败: ' + e.message);
    }
});

// 在备注页中定位备注占位符形状：优先 ppPlaceholderBody(2)/ppPlaceholderObject(7)，其次找第一个有文本的文本框
function findNotesShape(notesPage) {
    try {
        for (var j = 1; j <= notesPage.Shapes.Count; j++) {
            var s = notesPage.Shapes.Item(j);
            try {
                var pf = s.PlaceholderFormat;
                if (pf && (pf.Type === 2 || pf.Type === 7)) return s;
            } catch (e) {}
        }
        // 兜底：第一个 HasTextFrame 且 HasText 的形状
        for (var j = 1; j <= notesPage.Shapes.Count; j++) {
            var s = notesPage.Shapes.Item(j);
            try { if (s.HasTextFrame && s.TextFrame.HasText) return s; } catch (e) {}
        }
    } catch (e) {}
    return null;
}

registerHandler('getSlideNotes', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var notes = '';
        try {
            var shape = findNotesShape(slide.NotesPage.Shapes);
            if (shape) notes = shape.TextFrame.TextRange.Text || '';
        } catch (e) {}
        return ok({ slideIndex: idx, notes: notes });
    } catch (e) {
        return fail('获取备注失败: ' + e.message);
    }
});

registerHandler('setSlideNotes', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shape = findNotesShape(slide.NotesPage.Shapes);
        if (!shape) return fail('未找到备注占位符，无法写入备注');
        shape.TextFrame.TextRange.Text = params.notes || '';
        return ok({});
    } catch (e) {
        return fail('设置备注失败: ' + e.message);
    }
});

registerHandler('exportSlideAsImage', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var outputPath = params.outputPath || params.path;
        if (!outputPath) return invalidParam('缺少 outputPath');
        var slide = pres.Slides.Item(idx);
        slide.Export(outputPath, params.format || 'PNG', params.width || 1920, params.height || 1080);
        return ok({ slideIndex: idx, outputPath: outputPath });
    } catch (e) {
        return fail('导出幻灯片为图片失败: ' + e.message);
    }
});

registerHandler('applyColorScheme', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var scheme = COLOR_SCHEMES[params.style] || COLOR_SCHEMES.business;
        var count = 0;
        for (var i = 1; i <= pres.Slides.Count; i++) {
            var slide = pres.Slides.Item(i);
            for (var j = 1; j <= slide.Shapes.Count; j++) {
                try {
                    var s = slide.Shapes.Item(j);
                    if (s.HasTextFrame && s.TextFrame.HasText) {
                        var tr = s.TextFrame.TextRange;
                        if (tr.Font.Size >= 24) tr.Font.Color.RGB = scheme.title;
                        else tr.Font.Color.RGB = scheme.body;
                        count++;
                    }
                } catch (e) {}
            }
        }
        return ok({ style: params.style || 'business', count: count });
    } catch (e) {
        return fail('应用配色方案失败: ' + e.message);
    }
});

registerHandler('setMasterBackground', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var master = pres.SlideMaster;
        if (params.color !== undefined) {
            var bg = toRgb(params.color);
            if (bg === null) return fail('无效的背景颜色: ' + params.color);
            master.Background.Fill.ForeColor.RGB = bg;
            master.Background.Fill.Visible = 1;
        }
        return ok({});
    } catch (e) {
        return fail('设置母版背景失败: ' + e.message);
    }
});

registerHandler('getSlideMaster', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var master = pres.SlideMaster;
        return ok({ name: master.Name, width: master.Width, height: master.Height });
    } catch (e) {
        return fail('获取母版信息失败: ' + e.message);
    }
});

registerHandler('setPptFooter', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var hf = pres.SlideMaster.HeadersFooters;
        hf.Footer.Visible = 1;
        hf.Footer.Text = params.text || '';
        return ok({});
    } catch (e) {
        return fail('设置页脚失败: ' + e.message);
    }
});

registerHandler('setPptDateTime', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var hf = pres.SlideMaster.HeadersFooters;
        hf.DateAndTime.Visible = 1;
        if (params.format === 'auto') hf.DateAndTime.UseFormat = true;
        else hf.DateAndTime.Text = params.text || '';
        return ok({});
    } catch (e) {
        return fail('设置日期时间失败: ' + e.message);
    }
});

registerHandler('setImageStyle', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName) {
                if (params.width !== undefined) s.Width = params.width;
                if (params.height !== undefined) s.Height = params.height;
                if (params.borderColor) {
                    var bc = toRgb(params.borderColor);
                    if (bc === null) return fail('无效的边框颜色: ' + params.borderColor);
                    s.Line.Visible = 1;
                    s.Line.ForeColor.RGB = bc;
                }
                if (params.borderWidth) s.Line.Weight = params.borderWidth;
                return ok({});
            }
        }
        return fail('未找到图片: ' + shapeName);
    } catch (e) {
        return fail('设置图片样式失败: ' + e.message);
    }
});

function findShape(slide, nameOrIndex) {
    if (typeof nameOrIndex === 'number') {
        try { return slide.Shapes.Item(nameOrIndex); } catch (e) { return null; }
    }
    if (nameOrIndex == null) return slide.Shapes.Count > 0 ? slide.Shapes.Item(1) : null;
    for (var j = 1; j <= slide.Shapes.Count; j++) {
        if (slide.Shapes.Item(j).Name === nameOrIndex) return slide.Shapes.Item(j);
    }
    return null;
}

registerHandler('setBackgroundColor', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        slide.FollowMasterBackground = 0;
        slide.Background.Fill.ForeColor.RGB = params.color !== undefined ? toRgb(params.color) || 0xFFFFFF : 0xFFFFFF;
        slide.Background.Fill.Visible = 1;
        return ok({});
    } catch (e) {
        return fail('设置背景颜色失败: ' + e.message);
    }
});

registerHandler('setBackgroundImage', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var filePath = params.path || params.imagePath;
        if (!filePath) return invalidParam('缺少 path');
        var slide = pres.Slides.Item(idx);
        slide.FollowMasterBackground = 0;
        slide.Background.Fill.UserPicture(filePath);
        return ok({});
    } catch (e) {
        return fail('设置背景图片失败: ' + e.message);
    }
});

registerHandler('setBackgroundGradient', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        slide.FollowMasterBackground = 0;
        slide.Background.Fill.OneColorGradient(1, 1, 0.5);
        return ok({});
    } catch (e) {
        return fail('设置渐变背景失败: ' + e.message);
    }
});

registerHandler('setShapeGradient', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName) {
                s.Fill.OneColorGradient(1, 1, 0.5);
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置形状渐变失败: ' + e.message);
    }
});

registerHandler('setShapeFullStyle', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName) {
                if (params.fillColor) {
                    var fc = toRgb(params.fillColor);
                    if (fc === null) return fail('无效的填充颜色: ' + params.fillColor);
                    s.Fill.ForeColor.RGB = fc;
                    s.Fill.Visible = 1;
                }
                if (params.lineColor) {
                    var lc = toRgb(params.lineColor);
                    if (lc === null) return fail('无效的线条颜色: ' + params.lineColor);
                    s.Line.ForeColor.RGB = lc;
                    s.Line.Visible = 1;
                }
                if (params.lineWeight) s.Line.Weight = params.lineWeight;
                if (params.shadow) { s.Shadow.Visible = 1; }
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置形状完整样式失败: ' + e.message);
    }
});

registerHandler('setShapeRoundness', function(params) {
    try {
        var pres = getPPT();
        if (!pres) return fail('没有打开的演示文稿');
        var idx = params.slideIndex || 1;
        var slide = pres.Slides.Item(idx);
        var shapeName = params.shapeName || params.name;
        for (var j = 1; j <= slide.Shapes.Count; j++) {
            var s = slide.Shapes.Item(j);
            if (s.Name === shapeName) {
                // 仅圆角矩形（msoShapeRoundedRectangle=5）支持圆角调整，其它形状无 Adjustments 或类型不匹配
                if (s.Type !== 5 && s.AutoShapeType !== 5) {
                    return fail('仅支持对圆角矩形设置圆角，当前形状类型: ' + s.Type);
                }
                // WPS JSAPI 写法：Item(索引, 值) 传第二参数（与 Mac 版 opencode-wps-assistant 一致），
                // 不能用 Item(1) = value 赋值（那是 VBA 语法，JS 运行时必报 Invalid left-hand side）
                try { s.Adjustments.Item(1, params.roundness || 0.2); } catch (adjE) {
                    return fail('设置圆角失败: ' + adjE.message);
                }
                return ok({});
            }
        }
        return fail('未找到形状: ' + shapeName);
    } catch (e) {
        return fail('设置形状圆角失败: ' + e.message);
    }
});

registerHandler('setFontColor', function(params) {
    try {
        var pres = Application.ActivePresentation;
        if (!pres) return fail('没有打开的演示文稿');
        var slideIndex = params.slideIndex || 1;
        var slide = pres.Slides.Item(slideIndex);
        var shape = findShape(slide, params.shapeIndex !== undefined ? params.shapeIndex : params.shapeName);
        if (!shape) return fail('未找到形状');
        var textRange = shape.TextFrame.TextRange;
        // PPT ForeColor.RGB 需要 RGB 顺序（非 BGR），统一走 toRgb（数字直返/字符串解析/非法 fail）
        var color = toRgb(params.color);
        if (color === null) return fail('无效的颜色值: ' + params.color + '，支持 #RRGGBB/RRGGBB/数字');
        textRange.Font.Color.RGB = color;
        if (params.size) textRange.Font.Size = params.size;
        if (params.bold !== undefined) textRange.Font.Bold = params.bold;
        return ok({});
    } catch (e) {
        return fail('设置字体颜色失败: ' + e.message);
    }
});

registerHandler('setSlideSize', function(params) {
    try {
        var pres = Application.ActivePresentation;
        if (!pres) return fail('没有打开的演示文稿');
        var width = params.width;
        var height = params.height;
        if (width) pres.PageSetup.SlideWidth = width;
        if (height) pres.PageSetup.SlideHeight = height;
        return ok({});
    } catch (e) {
        return fail('设置幻灯片大小失败: ' + e.message);
    }
});

registerHandler('setShapeFill', function(params) {
    try {
        var pres = Application.ActivePresentation;
        if (!pres) return fail('没有打开的演示文稿');
        var slideIndex = params.slideIndex || 1;
        var slide = pres.Slides.Item(slideIndex);
        var shape = findShape(slide, params.shapeIndex !== undefined ? params.shapeIndex : params.shapeName);
        if (!shape) return fail('未找到形状');
        if (params.fillColor !== undefined) {
            var color = toRgb(params.fillColor);
            if (color === null) return fail('无效的填充颜色: ' + params.fillColor + '，支持 #RRGGBB/RRGGBB/数字');
            shape.Fill.ForeColor.RGB = color;
        }
        if (params.transparency !== undefined) shape.Fill.Transparency = params.transparency;
        if (params.gradient !== undefined) shape.Fill.OneColorGradient(params.gradient.style, params.gradient.variant || 1, params.gradient.degree || 1);
        return ok({});
    } catch (e) {
        return fail('设置形状填充失败: ' + e.message);
    }
});

registerHandler('setSlideTheme', function(params) {
    try {
        var pres = Application.ActivePresentation;
        if (!pres) return fail('没有打开的演示文稿');
        var theme = params.theme;
        if (typeof pres.ApplyTemplate === 'function') {
            pres.ApplyTemplate(theme);
        } else if (typeof pres.ApplyTheme === 'function') {
            pres.ApplyTheme(theme);
        } else {
            return fail('此 WPS 版本不支持 ApplyTemplate/ApplyTheme');
        }
        return ok({});
    } catch (e) {
        return fail('设置主题失败: ' + e.message);
    }
});
