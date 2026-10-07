using Autodesk.AutoCAD.Geometry;

namespace DwgPdf;

internal static class Geometry
{
    public static bool Rectangle(Point3d[] p)
    {
        if (p.Length != 4) return false;
        var edges = Enumerable.Range(0, 4).Select(i => p[(i + 1) % 4] - p[i]).ToArray();
        if (edges.Any(e => e.Length < 1e-8)) return false;
        var scale = edges.Max(e => e.Length);
        if (p.Any(v => Math.Abs(v.Z - p[0].Z) > scale * 1e-6)) return false;
        for (var i = 0; i < 4; i++)
            if (Math.Abs(edges[i].GetNormal().DotProduct(edges[(i + 1) % 4].GetNormal())) > 1e-5) return false;
        return (edges[0] + edges[2]).Length < scale * 1e-5 && (edges[1] + edges[3]).Length < scale * 1e-5;
    }
    public static double Width(Point3d[] p) => p[0].DistanceTo(p[1]);
    public static double Height(Point3d[] p) => p[1].DistanceTo(p[2]);
    public static Point3d Center(Point3d[] p) => new(p.Average(x => x.X), p.Average(x => x.Y), p.Average(x => x.Z));
    public static double Aspect(Point3d[] p) => Math.Max(Width(p), Height(p)) / Math.Min(Width(p), Height(p));
    public static bool SimilarAspect(Point3d[] a, Point3d[] b) => Math.Abs(Aspect(a) / Aspect(b) - 1) < .02;
    public static bool SameSize(Point3d[] a, Point3d[] b, double unitFactor)
    {
        var aa = new[] { Width(a), Height(a) }.Order().ToArray();
        var bb = new[] { Width(b) * unitFactor, Height(b) * unitFactor }.Order().ToArray();
        return Enumerable.Range(0, 2).All(i => Math.Abs(aa[i] / bb[i] - 1) < .03);
    }
    public static bool Duplicate(Point3d[] a, Point3d[] b) => Center(a).DistanceTo(Center(b)) < Math.Min(Width(a), Height(a)) * .025 && Math.Abs(Width(a) * Height(a) / (Width(b) * Height(b)) - 1) < .08;
    public static double UnitMillimeters(int units) => units switch { 1 => 25.4, 2 => 304.8, 4 => 1, 5 => 10, 6 => 1000, 7 => 1000000, 21 => 304.800609601, _ => 0 };
}
