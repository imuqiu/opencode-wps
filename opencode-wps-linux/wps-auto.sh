#!/bin/bash
# OpenCode AI - WPS 应用自动切换脚本 (Linux)
# 用于自动关闭当前 WPS 并启动指定应用（文字/表格/演示）
#
# Linux 版 WPS 安装后提供独立命令：
#   wps  -> WPS 文字 (Writer)
#   et   -> WPS 表格 (Spreadsheet)
#   wpp  -> WPS 演示 (Presentation)
# 若命令不存在，则回退到 xdg-open 打开空白 Office 文件。

SERVER_URL="http://127.0.0.1:58891"
POLL_TIMEOUT=30
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

create_blank_file() {
    local file_type=$1
    local file_path="/tmp/opencode_auto_blank"

    case $file_type in
        "xlsx")
            python3 -c "
import zipfile
with zipfile.ZipFile('${file_path}.xlsx', 'w') as zf:
    zf.writestr('[Content_Types].xml', '<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/></Types>')
    zf.writestr('_rels/.rels', '<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>')
    zf.writestr('xl/workbook.xml', '<?xml version=\"1.0\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"/></sheets></workbook>')
    zf.writestr('xl/_rels/workbook.xml.rels', '<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>')
    zf.writestr('xl/worksheets/sheet1.xml', '<?xml version=\"1.0\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData/></worksheet>')
" 2>/dev/null
            echo "${file_path}.xlsx"
            ;;
        "docx")
            python3 -c "
import zipfile
with zipfile.ZipFile('${file_path}.docx', 'w') as zf:
    zf.writestr('[Content_Types].xml', '<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>')
    zf.writestr('_rels/.rels', '<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>')
    zf.writestr('word/document.xml', '<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t></w:t></w:r></w:p></w:body></w:document>')
" 2>/dev/null
            echo "${file_path}.docx"
            ;;
        "pptx")
            python3 -c "
from pptx import Presentation
p = Presentation()
p.slides.add_slide(p.slide_layouts[6])
p.save('${file_path}.pptx')
" 2>/dev/null
            echo "${file_path}.pptx"
            ;;
    esac
}

# 判断 WPS 是否已安装（wps/et/wpp 任一命令存在即视为已安装）
wps_installed() {
    command -v wps >/dev/null 2>&1 || command -v et >/dev/null 2>&1 || command -v wpp >/dev/null 2>&1
}

close_all() {
    echo "[WPS-Auto] 关闭所有 WPS 应用..."
    for name in "wps" "et" "wpp" "wpsoffice" "wpspdf" "kingsoft"; do
        pkill -f "$name" 2>/dev/null || true
    done
    sleep 2
}

start_app() {
    local app_type=$1
    local file_path=""
    local app_cmd=""

    case $app_type in
        "et"|"excel")
            echo "[WPS-Auto] 启动 WPS 表格..."
            file_path=$(create_blank_file "xlsx")
            app_cmd="et"
            ;;
        "wps"|"word")
            echo "[WPS-Auto] 启动 WPS 文字..."
            file_path=$(create_blank_file "docx")
            app_cmd="wps"
            ;;
        "wpp"|"ppt")
            echo "[WPS-Auto] 启动 WPS 演示..."
            file_path=$(create_blank_file "pptx")
            app_cmd="wpp"
            ;;
        *)
            echo "[WPS-Auto] 未知应用: $app_type"
            return 1
            ;;
    esac

    # 优先使用 WPS 原生命令；不存在时回退 xdg-open
    if command -v "$app_cmd" >/dev/null 2>&1; then
        nohup "$app_cmd" "$file_path" >/dev/null 2>&1 &
    elif command -v xdg-open >/dev/null 2>&1; then
        nohup xdg-open "$file_path" >/dev/null 2>&1 &
    else
        echo "[WPS-Auto] 未找到启动命令: $app_cmd / xdg-open"
        return 1
    fi
    return 0
}

switch_to() {
    local target=$1
    close_all
    sleep 2
    start_app "$target"
    sleep 3
}

case $1 in
    "switch")
        switch_to "$2"
        ;;
    "start")
        start_app "$2"
        ;;
    "stop"|"close")
        close_all
        ;;
    *)
        echo "OpenCode AI WPS 自动切换脚本 (Linux)"
        echo "用法:"
        echo "  $0 switch <app>   切换到指定应用 (excel/word/ppt)"
        echo "  $0 start <app>    启动指定应用"
        echo "  $0 stop           关闭所有 WPS"
        ;;
esac
