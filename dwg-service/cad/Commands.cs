using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Runtime.InteropServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.PlottingServices;
using Autodesk.AutoCAD.Runtime;
using App = Autodesk.AutoCAD.ApplicationServices.Core.Application;
using AcadException = Autodesk.AutoCAD.Runtime.Exception;
using PlotType = Autodesk.AutoCAD.DatabaseServices.PlotType;

[assembly: CommandClass(typeof(DwgPdf.Commands))]
namespace DwgPdf;

public sealed class Options
{
    public string Mode { get; set; } = "analyze";
    public string Paper { get; set; } = "A3";
    public string Space { get; set; } = "model";
    public string ReferenceName { get; set; } = "reference.dwg";
    public string PlotStyle { get; set; } = "";
    public string[] Ids { get; set; } = [];
}
internal sealed record Candidate(string Id, string Name, string Source, string Confidence, Point3d[] Corners, ObjectId Layout);
internal sealed record Border(string Path, string OwnerName, string OwnerSignature, string Source, Point3d[] Corners);

public sealed class Commands
{
    [DllImport("gdi32.dll", EntryPoint = "AddFontResourceExW", CharSet = CharSet.Unicode)]
    private static extern int AddFontResourceEx(string filename, uint flags, IntPtr reserved);
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    private readonly List<string> warnings = [];
    private readonly Dictionary<ObjectId, string> signatures = [];
    private int visited;
    private string inputDirectory = "";
    private Dictionary<string, string[]> resources = [];

    [CommandMethod("DWGPDF", CommandFlags.Modal)]
    public void Convert()
    {
        var working = Directory.GetCurrentDirectory();
        var output = Path.Combine(working, "result");
        Directory.CreateDirectory(output);
        try
        {
            var options = JsonSerializer.Deserialize<Options>(File.ReadAllText(Path.Combine(working, "options.json")), Json) ?? throw new InvalidOperationException("출력 설정이 없습니다.");
            if (options.Space != "model" && options.Space != "layouts") throw new InvalidOperationException("지원하지 않는 출력 모드입니다.");
            inputDirectory = Path.Combine(working, "input");
            resources = Directory.GetFiles(inputDirectory, "*", SearchOption.AllDirectories).GroupBy(f => Path.GetFileName(f), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.ToArray(), StringComparer.OrdinalIgnoreCase);
            if (!resources.ContainsKey(options.ReferenceName)) resources[options.ReferenceName] = [Path.Combine(inputDirectory, "reference.dwg")];
            PrepareResources();
            var document = App.DocumentManager.MdiActiveDocument;
            var db = document.Database;
            PrepareDatabase(db);
            App.SetSystemVariable("BACKGROUNDPLOT", 0);
            var frames = options.Space == "layouts" ? Layouts(db) : Detect(db, options);
            if (frames.Count > 200) throw new InvalidOperationException("페이지가 200개를 초과합니다. 도면을 나누어 처리하세요.");
            if (options.Mode == "generate")
            {
                var ids = options.Ids.ToHashSet();
                if (ids.Count != options.Ids.Length || ids.Any(id => frames.All(f => f.Id != id))) throw new InvalidOperationException("출력할 도곽을 다시 찾지 못했습니다.");
                frames = options.Ids.Select(id => frames.Single(f => f.Id == id)).ToList();
            }
            var manifestFrames = new List<object>();
            foreach (var frame in frames)
            {
                var pdf = frame.Id + ".pdf";
                Plot(db, frame, options, Path.Combine(output, pdf));
                var center = Geometry.Center(frame.Corners);
                manifestFrames.Add(new { id = frame.Id, name = frame.Name, source = frame.Source, confidence = frame.Confidence, pdf, center = new[] { center.X, center.Y }, width = Geometry.Width(frame.Corners), height = Geometry.Height(frame.Corners), corners = frame.Corners.Select(p => new[] { p.X, p.Y }).ToArray() });
            }
            File.WriteAllText(Path.Combine(output, "manifest.json"), JsonSerializer.Serialize(new { frames = manifestFrames, warnings = warnings.Distinct() }, Json));
        }
        catch (System.Exception e)
        {
            foreach (var file in Directory.GetFiles(output)) File.Delete(file);
            File.WriteAllText(Path.Combine(output, "manifest.json"), JsonSerializer.Serialize(new { error = e.Message, frames = Array.Empty<object>(), warnings }, Json));
            App.DocumentManager.MdiActiveDocument.Editor.WriteMessage("\nDWGPDF failed: " + e.Message);
        }
        finally
        {
            var destination = Path.Combine(working, "result.zip");
            if (File.Exists(destination)) File.Delete(destination);
            ZipFile.CreateFromDirectory(output, destination);
        }
    }

    private string? Resource(string name)
    {
        var basename = Path.GetFileName(name.Replace('\\', '/'));
        if (!resources.TryGetValue(basename, out var matches)) return null;
        if (matches.Length != 1) throw new InvalidOperationException("관련 파일명이 중복됩니다: " + basename);
        return matches[0];
    }

    private void PrepareResources()
    {
        // SHX and XREF search works next to the drawing. Never copy or execute scripts.
        foreach (var pair in resources.ToArray())
        {
            if (pair.Value.Length != 1) continue;
            var file = pair.Value[0];
            var ext = Path.GetExtension(file).ToLowerInvariant();
            if (ext == ".shx" && Path.GetDirectoryName(file) != inputDirectory) File.Copy(file, Path.Combine(inputDirectory, Path.GetFileName(file)), true);
            if (ext is ".ctb" or ".stb")
            {
                // This is an isolated APS workitem profile, not the user's CAD installation.
                try
                {
                    var root = (string)App.GetSystemVariable("ROAMABLEROOTPREFIX");
                    var directory = Path.Combine(root, "Plotters", "Plot Styles");
                    Directory.CreateDirectory(directory); File.Copy(file, Path.Combine(directory, Path.GetFileName(file)), true);
                }
                catch (System.Exception) { warnings.Add("출력 스타일 검색 경로에 파일을 추가하지 못했습니다. 스타일 적용 실패 시 변환을 중단합니다."); }
            }
            if (ext == ".ttf")
            {
                // FR_PRIVATE: process-local registration, never install fonts system-wide.
                if (AddFontResourceEx(file, 0x10, IntPtr.Zero) == 0) warnings.Add("TTF를 로드하지 못했습니다: " + Path.GetFileName(file));
                else warnings.Add("사용자 TTF를 프로세스에 로드했습니다. 한글·문자 폭을 미리보기에서 확인하세요.");
            }
        }
    }

    private void PrepareDatabase(Database db)
    {
        using (var tr = db.TransactionManager.StartTransaction())
        {
            var blocks = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
            foreach (ObjectId id in blocks)
            {
                var block = (BlockTableRecord)tr.GetObject(id, OpenMode.ForRead);
                if (!block.IsFromExternalReference) continue;
                var file = Resource(block.PathName);
                block.UpgradeOpen();
                if (file != null) block.PathName = file;
                else
                {
                    block.PathName = Path.Combine(inputDirectory, "missing", Path.GetFileName(block.PathName.Replace('\\', '/')));
                    warnings.Add("누락된 XREF: " + block.Name);
                }
            }
            var dict = (DBDictionary)tr.GetObject(db.NamedObjectsDictionaryId, OpenMode.ForRead);
            if (dict.Contains("ACAD_IMAGE_DICT"))
            {
                var images = (DBDictionary)tr.GetObject(dict.GetAt("ACAD_IMAGE_DICT"), OpenMode.ForRead);
                foreach (DBDictionaryEntry entry in images)
                {
                    if (tr.GetObject(entry.Value, OpenMode.ForRead) is not RasterImageDef image) continue;
                    var file = Resource(image.SourceFileName);
                    image.UpgradeOpen();
                    image.SourceFileName = file ?? Path.Combine(inputDirectory, "missing", Path.GetFileName(image.SourceFileName.Replace('\\', '/')));
                    if (file == null) warnings.Add("누락된 이미지: " + entry.Key);
                    else try { image.Load(); } catch (AcadException) { warnings.Add("이미지를 읽지 못했습니다: " + entry.Key); }
                }
            }
            var styles = (TextStyleTable)tr.GetObject(db.TextStyleTableId, OpenMode.ForRead);
            foreach (ObjectId id in styles)
            {
                var style = (TextStyleTableRecord)tr.GetObject(id, OpenMode.ForRead);
                foreach (var font in new[] { style.FileName, style.BigFontFileName }.Where(s => !string.IsNullOrWhiteSpace(s)))
                {
                    var file = Resource(font);
                    if (file != null)
                    {
                        style.UpgradeOpen();
                        if (font == style.FileName) style.FileName = file; else style.BigFontFileName = file;
                    }
                    else try { HostApplicationServices.Current.FindFile(font, db, FindFileHint.Default); }
                    catch (AcadException) { warnings.Add("누락된 폰트: " + Path.GetFileName(font)); }
                }
            }
            tr.Commit();
        }
        try { db.ResolveXrefs(false, false); }
        catch (AcadException) { warnings.Add("일부 XREF를 해석하지 못했습니다. 미리보기에서 누락 여부를 확인하세요."); }
        // Re-map nested references after the first resolution pass.
        using var check = db.TransactionManager.StartTransaction();
        var table = (BlockTable)check.GetObject(db.BlockTableId, OpenMode.ForRead);
        foreach (ObjectId id in table)
        {
            var block = (BlockTableRecord)check.GetObject(id, OpenMode.ForRead);
            if (block.IsFromExternalReference && block.XrefStatus != XrefStatus.Resolved) warnings.Add("해결되지 않은 XREF: " + block.Name);
        }
        check.Commit();
        warnings.Add("외부참조·글꼴·치수·해치 및 특수 객체는 미리보기에서 원본과 비교해 확인하세요.");
    }

    private string Signature(BlockTableRecord block, Transaction tr)
    {
        if (signatures.TryGetValue(block.ObjectId, out var value)) return value;
        var counts = new Dictionary<string, int>();
        foreach (ObjectId id in block)
        {
            var entity = tr.GetObject(id, OpenMode.ForRead) as Entity;
            if (entity is DBText or MText or AttributeDefinition or AttributeReference) continue;
            var type = entity?.GetType().Name ?? "";
            counts[type] = counts.GetValueOrDefault(type) + 1;
        }
        value = string.Join(";", counts.OrderBy(p => p.Key).Select(p => p.Key + ":" + p.Value));
        signatures[block.ObjectId] = value; return value;
    }

    private List<Border> Borders(Database db)
    {
        using var tr = db.TransactionManager.StartTransaction();
        var blocks = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
        var result = new List<Border>(); visited = 0;
        Walk((BlockTableRecord)tr.GetObject(blocks[BlockTableRecord.ModelSpace], OpenMode.ForRead), tr, Matrix3d.Identity, "", "", "", "Rectangle", new HashSet<ObjectId>(), result);
        tr.Commit(); return result;
    }

    private void Walk(BlockTableRecord block, Transaction tr, Matrix3d transform, string prefix, string owner, string signature, string source, HashSet<ObjectId> ancestors, List<Border> result)
    {
        if (ancestors.Count >= 16 || !ancestors.Add(block.ObjectId)) return;
        var lines = new List<(string Id, Point3d Start, Point3d End)>();
        foreach (ObjectId id in block)
        {
            if (++visited > 200000) throw new InvalidOperationException("객체 분석 한도를 초과했습니다. 도면을 나누어 주세요.");
            if (tr.GetObject(id, OpenMode.ForRead) is not Entity entity || !entity.Visible) continue;
            var layer = (LayerTableRecord)tr.GetObject(entity.LayerId, OpenMode.ForRead);
            if (layer.IsOff || layer.IsFrozen) continue;
            var handle = prefix + entity.Handle.ToString();
            if (entity is BlockReference br)
            {
                if (br is MInsertBlock) { warnings.Add("MINSERT 다중 삽입 객체는 지원하지 않습니다. 일반 블록으로 변환해 주세요."); continue; }
                if (!br.ExtensionDictionary.IsNull && tr.GetObject(br.ExtensionDictionary, OpenMode.ForRead) is DBDictionary extensions && extensions.Contains("ACAD_FILTER")) warnings.Add("클리핑된 블록/XREF가 있습니다. 도곽 검출 경계를 미리보기에서 확인하세요.");
                var definition = (BlockTableRecord)tr.GetObject(br.BlockTableRecord, OpenMode.ForRead);
                var effective = br.IsDynamicBlock ? (BlockTableRecord)tr.GetObject(br.DynamicBlockTableRecord, OpenMode.ForRead) : definition;
                Walk(definition, tr, transform * br.BlockTransform, handle + "_", effective.Name, Signature(definition, tr), definition.IsFromExternalReference ? "XREF" : "Block", ancestors, result);
            }
            else if (entity is Polyline poly && poly.Closed && poly.NumberOfVertices == 4 && Enumerable.Range(0, 4).All(i => Math.Abs(poly.GetBulgeAt(i)) < 1e-10))
            {
                var corners = Enumerable.Range(0, 4).Select(i => poly.GetPoint3dAt(i).TransformBy(transform)).ToArray();
                if (Geometry.Rectangle(corners)) result.Add(new(handle, owner, signature, source, corners));
            }
            else if (entity is Line line) lines.Add((handle, line.StartPoint.TransformBy(transform), line.EndPoint.TransformBy(transform)));
        }
        // Build adjacency to find four-line loops without comparing every line to every line.
        if (lines.Count <= 10000)
        {
            string Key(Point3d p) => $"{Math.Round(p.X, 5):F5}/{Math.Round(p.Y, 5):F5}/{Math.Round(p.Z, 5):F5}";
            var adjacency = new Dictionary<string, List<int>>();
            for (var i = 0; i < lines.Count; i++) foreach (var point in new[] { lines[i].Start, lines[i].End })
            {
                var k = Key(point); if (!adjacency.TryGetValue(k, out var list)) adjacency[k] = list = []; list.Add(i);
            }
            var seen = new HashSet<string>();
            for (var i = 0; i < lines.Count; i++)
            {
                void Trace(List<int> used, List<Point3d> points, Point3d current)
                {
                    if (used.Count == 4)
                    {
                        if (current.DistanceTo(points[0]) > 1e-5 || !Geometry.Rectangle(points.ToArray())) return;
                        var loop = string.Join("_", used.Order().Select(j => lines[j].Id));
                        if (seen.Add(loop)) result.Add(new(loop, owner, signature, source, points.ToArray()));
                        return;
                    }
                    if (!adjacency.TryGetValue(Key(current), out var next) || next.Count > 8) return;
                    foreach (var j in next.Where(j => j >= i && !used.Contains(j)))
                    {
                        var end = current.DistanceTo(lines[j].Start) < 1e-5 ? lines[j].End : lines[j].Start;
                        Trace([.. used, j], [.. points, current], end);
                    }
                }
                Trace([i], [lines[i].Start], lines[i].End);
            }
        }
        else warnings.Add("선분이 매우 많은 블록의 사각형 보완 검출을 생략했습니다.");
        ancestors.Remove(block.ObjectId);
    }

    private List<Candidate> Detect(Database db, Options options)
    {
        using var reference = new Database(false, true);
        reference.ReadDwgFile(Path.Combine(inputDirectory, "reference.dwg"), FileOpenMode.OpenForReadAndAllShare, false, null);
        reference.CloseInput(true);
        var referenceBorders = Borders(reference).OrderByDescending(b => Geometry.Width(b.Corners) * Geometry.Height(b.Corners)).ToList();
        if (referenceBorders.Count == 0) throw new InvalidOperationException("기준 DWG에서 사각형 도곽을 찾지 못했습니다. 닫힌 4점 폴리라인 또는 4개 선분의 도곽을 사용하세요.");
        var template = referenceBorders[0];
        if (referenceBorders.Any(b => !Geometry.Duplicate(b.Corners, template.Corners) && Geometry.Width(b.Corners) * Geometry.Height(b.Corners) > Geometry.Width(template.Corners) * Geometry.Height(template.Corners) * .8))
            throw new InvalidOperationException("기준 DWG에 큰 사각형이 여러 개 있습니다. 기준 도곽 하나만 포함한 파일을 사용하세요.");
        var refUnit = Geometry.UnitMillimeters((int)reference.Insunits);
        var drawUnit = Geometry.UnitMillimeters((int)db.Insunits);
        var factor = refUnit > 0 && drawUnit > 0 ? refUnit / drawUnit : 1;
        if (refUnit == 0 || drawUnit == 0) warnings.Add("도면 단위를 확정할 수 없어 사각형 크기를 도면 좌표 기준으로 비교했습니다.");
        var names = new[] { template.OwnerName, Path.GetFileNameWithoutExtension(options.ReferenceName) }.Where(s => !string.IsNullOrWhiteSpace(s)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var all = Borders(db);
        var chosen = new List<Border>();
        foreach (var border in all.OrderByDescending(b => b.Source == "XREF" ? 3 : b.Source == "Block" ? 2 : 1).ThenByDescending(b => Geometry.Width(b.Corners) * Geometry.Height(b.Corners)))
        {
            if (!Geometry.SimilarAspect(border.Corners, template.Corners)) continue;
            var named = names.Contains(border.OwnerName) || names.Contains(border.OwnerName.Split('|').Last());
            var structural = !string.IsNullOrEmpty(template.OwnerSignature) && border.OwnerSignature == template.OwnerSignature;
            if (!(named || structural) && !Geometry.SameSize(border.Corners, template.Corners, factor)) continue;
            if (chosen.Any(b => Geometry.Duplicate(b.Corners, border.Corners))) continue;
            chosen.Add(border);
        }
        if (chosen.Any(b => b.Source == "Rectangle")) warnings.Add("크기 기반 사각형 후보가 있습니다. 표나 다른 영역이 포함되지 않았는지 확인하세요.");
        return chosen.Select(b => new Candidate("f_" + System.Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(b.Path)))[..20].ToLowerInvariant(), string.IsNullOrEmpty(b.OwnerName) ? "사각형 도곽" : b.OwnerName, b.Source, names.Contains(b.OwnerName) ? "이름·형상 일치" : "형상 후보 · 확인 필요", b.Corners, ObjectId.Null)).ToList();
    }

    private List<Candidate> Layouts(Database db)
    {
        using var tr = db.TransactionManager.StartTransaction();
        var dict = (DBDictionary)tr.GetObject(db.LayoutDictionaryId, OpenMode.ForRead);
        var frames = new List<Candidate>();
        foreach (DBDictionaryEntry entry in dict)
        {
            var layout = (Layout)tr.GetObject(entry.Value, OpenMode.ForRead);
            if (layout.ModelType) continue;
            var size = layout.PlotPaperSize;
            var factor = layout.PlotPaperUnits == PlotPaperUnit.Inches ? 25.4 : 1;
            var width = size.X * factor; var height = size.Y * factor;
            if (width <= 0 || height <= 0) { width = 420; height = 297; warnings.Add("용지 크기를 확인할 수 없는 Layout은 A3로 표시합니다: " + layout.LayoutName); }
            frames.Add(new("l_" + layout.Handle, layout.LayoutName, "Layout", "기존 Layout", [new(0, 0, 0), new(width, 0, 0), new(width, height, 0), new(0, height, 0)], layout.ObjectId));
        }
        // The server preserves tab order for layouts instead of coordinate sorting.
        frames = frames.OrderBy(f => ((Layout)tr.GetObject(f.Layout, OpenMode.ForRead)).TabOrder).ToList();
        tr.Commit(); return frames;
    }

    private void Plot(Database db, Candidate frame, Options options, string destination)
    {
        var document = App.DocumentManager.MdiActiveDocument;
        var model = frame.Layout.IsNull;
        var manager = LayoutManager.Current;
        manager.CurrentLayout = model ? "Model" : frame.Name;
        using var tr = db.TransactionManager.StartTransaction();
        var layoutId = model ? manager.GetLayoutId("Model") : frame.Layout;
        var layout = (Layout)tr.GetObject(layoutId, OpenMode.ForRead);
        using var settings = new PlotSettings(model);
        settings.CopyFrom(layout);
        var validator = PlotSettingsValidator.Current;
        var oldMedia = settings.CanonicalMediaName;
        validator.SetPlotConfigurationName(settings, "DWG To PDF.pc3", null);
        validator.RefreshLists(settings);
        var media = validator.GetCanonicalMediaNameList(settings).Cast<string>().ToArray();
        var selected = options.Paper == "layout" && !model
            ? media.FirstOrDefault(s => s == oldMedia)
            : media.FirstOrDefault(s => s.Contains("ISO_full_bleed_" + options.Paper + "_", StringComparison.OrdinalIgnoreCase)) ?? media.FirstOrDefault(s => s.Contains("_" + options.Paper + "_", StringComparison.OrdinalIgnoreCase));
        if (selected == null) throw new InvalidOperationException("선택한 용지를 PDF 출력 장치에서 찾지 못했습니다.");
        validator.SetCanonicalMediaName(settings, selected);
        validator.SetPlotPaperUnits(settings, PlotPaperUnit.Millimeters);
        if (model || options.Paper != "layout")
        {
            validator.SetPlotType(settings, model ? PlotType.Window : PlotType.Extents);
            var landscape = Geometry.Width(frame.Corners) >= Geometry.Height(frame.Corners);
            var size = settings.PlotPaperSize;
            validator.SetPlotRotation(settings, (size.X >= size.Y) == landscape ? PlotRotation.Degrees000 : PlotRotation.Degrees090);
            validator.SetUseStandardScale(settings, true);
            validator.SetStdScaleType(settings, StdScaleType.ScaleToFit);
            if (settings.PlotType != PlotType.Layout) validator.SetPlotCentered(settings, true);
        }
        settings.PrintLineweights = true; settings.PlotPlotStyles = true;
        var style = string.IsNullOrWhiteSpace(options.PlotStyle) ? settings.CurrentStyleSheet : options.PlotStyle;
        if (!string.IsNullOrWhiteSpace(style))
        {
            var available = validator.GetPlotStyleSheetList().Cast<string>().ToArray();
            if (!available.Contains(style, StringComparer.OrdinalIgnoreCase)) throw new InvalidOperationException("출력 스타일이 없습니다: " + style + ". 관련 파일 ZIP에 포함하세요.");
            validator.SetCurrentStyleSheet(settings, style);
        }
        else warnings.Add("CTB/STB 출력 스타일이 지정되지 않았습니다. 객체 자체의 색상·선 굵기를 사용합니다.");
        if (model)
        {
            var corners = frame.Corners; var center = Geometry.Center(corners);
            var edge = corners[1] - corners[0]; var angle = Math.Atan2(edge.Y, edge.X);
            using var view = document.Editor.GetCurrentView();
            view.ViewDirection = Vector3d.ZAxis; view.Target = center; view.ViewTwist = -angle;
            view.CenterPoint = Point2d.Origin; view.Width = Geometry.Width(corners); view.Height = Geometry.Height(corners);
            document.Editor.SetCurrentView(view); document.Editor.Regen();
            var dcs = (Matrix3d.Rotation(-view.ViewTwist, view.ViewDirection, view.Target) * Matrix3d.Displacement(view.Target - Point3d.Origin) * Matrix3d.PlaneToWorld(view.ViewDirection)).Inverse();
            var points = corners.Select(p => p.TransformBy(dcs)).ToArray();
            validator.SetPlotType(settings, PlotType.Window);
            validator.SetPlotWindowArea(settings, new Extents2d(points.Min(p => p.X), points.Min(p => p.Y), points.Max(p => p.X), points.Max(p => p.Y)));
            validator.SetPlotCentered(settings, true);
        }
        else document.Editor.SwitchToPaperSpace();
        using var info = new PlotInfo { Layout = layoutId, OverrideSettings = settings };
        using var infoValidator = new PlotInfoValidator { MediaMatchingPolicy = MatchingPolicy.MatchEnabled };
        infoValidator.Validate(info);
        using var engine = PlotFactory.CreatePublishEngine();
        engine.BeginPlot(null, null);
        engine.BeginDocument(info, document.Name, null, 1, true, destination);
        using var page = new PlotPageInfo();
        engine.BeginPage(page, info, true, null);
        engine.BeginGenerateGraphics(null); engine.EndGenerateGraphics(null);
        engine.EndPage(null); engine.EndDocument(null); engine.EndPlot(null);
        tr.Commit();
        if (!File.Exists(destination)) throw new InvalidOperationException("PDF 파일이 생성되지 않았습니다.");
    }
}
