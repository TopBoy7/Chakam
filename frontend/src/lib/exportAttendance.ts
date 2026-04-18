// =============================================================================
// ATTENDANCE EXPORT UTILITY
// =============================================================================
// Generates properly formatted attendance documents in four formats:
//   CSV  — spreadsheet-ready, opens in Excel / Google Sheets
//   JSON — structured machine-readable data
//   DOCX — formatted Word document with a table and summary section
//   PDF  — print-ready A4 document with colour-coded status column
//
// Entry point: exportAttendance(format, course, session, students, records)
// All formats are generated and downloaded entirely in the browser — no server
// round-trip or new backend endpoint is required.
// =============================================================================

import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  AlignmentType,
  WidthType,
  ShadingType,
  BorderStyle,
  convertInchesToTwip,
} from "docx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import type {
  Course,
  Session,
  RegisteredStudent,
  AttendanceRecord,
} from "@/types/attendance";

// ── Public types ─────────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "json" | "docx" | "pdf";

interface ExportRow {
  sn: number;
  matricNumber: string;
  status: "present" | "absent";
  method: "camera" | "manual" | null;
  detectedAt: string | null;
}

interface ExportMeta {
  course: Course;
  session: Session;
  rows: ExportRow[];
  presentCount: number;
  absentCount: number;
  totalCount: number;
  attendanceRate: string;
  sessionDate: string;
  sessionStart: string;
  sessionEnd: string | null;
  durationMin: number | null;
  venue: string | null;
  filename: string;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function exportAttendance(
  exportFormat: ExportFormat,
  course: Course,
  session: Session,
  students: RegisteredStudent[],
  records: AttendanceRecord[]
): Promise<void> {
  const meta = buildMeta(course, session, students, records);

  switch (exportFormat) {
    case "csv":
      exportCSV(meta);
      break;
    case "json":
      exportJSON(meta);
      break;
    case "docx":
      await exportDOCX(meta);
      break;
    case "pdf":
      exportPDF(meta);
      break;
  }
}

// ── Build shared metadata ────────────────────────────────────────────────────

function buildMeta(
  course: Course,
  session: Session,
  students: RegisteredStudent[],
  records: AttendanceRecord[]
): ExportMeta {
  const rows: ExportRow[] = students.map((s, i) => {
    const rec = records.find((r) => r.studentId === s.id);
    return {
      sn: i + 1,
      matricNumber: s.matricNumber,
      status: rec?.status ?? "absent",
      method: rec ? (rec.manuallyOverridden ? "manual" : "camera") : null,
      detectedAt: rec?.detectedAt ?? null,
    };
  });

  const presentCount = rows.filter((r) => r.status === "present").length;
  const totalCount = students.length;
  const absentCount = totalCount - presentCount;
  const attendanceRate =
    totalCount > 0
      ? `${Math.round((presentCount / totalCount) * 100)}%`
      : "0%";

  const sessionDate = format(new Date(session.startedAt), "MMMM d, yyyy");
  const sessionStart = format(new Date(session.startedAt), "h:mm a");
  const sessionEnd = session.endedAt
    ? format(new Date(session.endedAt), "h:mm a")
    : null;
  const durationMin = session.endedAt
    ? Math.round(
        (new Date(session.endedAt).getTime() -
          new Date(session.startedAt).getTime()) /
          60000
      )
    : null;

  const safeCode = course.courseCode.replace(/[^a-zA-Z0-9]/g, "_");
  const safeDate = format(new Date(session.startedAt), "yyyy-MM-dd");
  const filename = `${safeCode}_${safeDate}_attendance`;

  return {
    course,
    session,
    rows,
    presentCount,
    absentCount,
    totalCount,
    attendanceRate,
    sessionDate,
    sessionStart,
    sessionEnd,
    durationMin,
    venue: session.classroomName ?? null,
    filename,
  };
}

// ── Shared download trigger ───────────────────────────────────────────────────

function downloadFile(
  content: string | Blob,
  filename: string,
  mimeType?: string
) {
  const blob =
    content instanceof Blob
      ? content
      : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function exportCSV(m: ExportMeta) {
  const timeLabel = [
    m.sessionStart,
    m.sessionEnd ? `– ${m.sessionEnd}` : "",
    m.durationMin ? `(${m.durationMin} min)` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const headerLines = [
    `Course Code,${m.course.courseCode}`,
    `Course Title,${m.course.courseName}`,
    `Date,${m.sessionDate}`,
    `Time,${timeLabel}`,
    m.venue ? `Venue,${m.venue}` : "",
    `Generated,"${new Date().toLocaleString()}"`,
    "",
    "S/N,Matric Number,Status,Method,Detected At",
  ].filter((l) => l !== "");

  const dataLines = m.rows.map((r) =>
    [
      r.sn,
      r.matricNumber,
      r.status === "present" ? "Present" : "Absent",
      r.method === "camera" ? "Camera" : r.method === "manual" ? "Manual" : "",
      r.detectedAt ? format(new Date(r.detectedAt), "h:mm a") : "",
    ].join(",")
  );

  const footerLines = [
    "",
    `Present,${m.presentCount}`,
    `Absent,${m.absentCount}`,
    `Total,${m.totalCount}`,
    `Attendance Rate,${m.attendanceRate}`,
  ];

  downloadFile(
    [...headerLines, ...dataLines, ...footerLines].join("\n"),
    `${m.filename}.csv`,
    "text/csv;charset=utf-8;"
  );
}

// ── JSON ──────────────────────────────────────────────────────────────────────

function exportJSON(m: ExportMeta) {
  const payload = {
    report: "Chakam Attendance Report",
    generatedAt: new Date().toISOString(),
    course: {
      code: m.course.courseCode,
      title: m.course.courseName,
    },
    session: {
      id: m.session.id,
      date: m.sessionDate,
      startTime: m.sessionStart,
      endTime: m.sessionEnd,
      durationMinutes: m.durationMin,
      venue: m.venue,
      status: m.session.status,
    },
    attendance: m.rows.map((r) => ({
      sn: r.sn,
      matricNumber: r.matricNumber,
      status: r.status,
      method: r.method,
      detectedAt: r.detectedAt,
    })),
    summary: {
      present: m.presentCount,
      absent: m.absentCount,
      total: m.totalCount,
      attendanceRate: m.attendanceRate,
    },
  };

  downloadFile(
    JSON.stringify(payload, null, 2),
    `${m.filename}.json`,
    "application/json"
  );
}

// ── DOCX ──────────────────────────────────────────────────────────────────────

async function exportDOCX(m: ExportMeta) {
  // Colour constants (hex without #)
  const BLUE      = "1E40AF";
  const BLUE_LIGHT = "DBEAFE";
  const GREEN_BG  = "DCFCE7";
  const GREEN_FG  = "166534";
  const RED_BG    = "FEE2E2";
  const RED_FG    = "991B1B";
  const GREY_BG   = "F8FAFC";
  const BORDER_COLOR = "E2E8F0";

  const cellBorder = {
    top:    { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
    left:   { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
    right:  { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  };

  // Helper — header cell (blue bg, white text)
  const headCell = (text: string, width: number) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: { type: ShadingType.SOLID, fill: BLUE, color: "FFFFFF" },
      borders: cellBorder,
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text, bold: true, color: "FFFFFF", size: 18 }),
          ],
        }),
      ],
    });

  // Helper — data cell
  const dataCell = (
    text: string,
    width: number,
    opts: {
      fill?: string;
      color?: string;
      bold?: boolean;
      mono?: boolean;
      align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    } = {}
  ) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: {
        type: ShadingType.SOLID,
        fill: opts.fill ?? GREY_BG,
        color: opts.fill ?? GREY_BG,
      },
      borders: cellBorder,
      children: [
        new Paragraph({
          alignment: opts.align ?? AlignmentType.LEFT,
          children: [
            new TextRun({
              text,
              bold: opts.bold ?? false,
              color: opts.color ?? "334155",
              size: 18,
              font: opts.mono ? "Courier New" : "Calibri",
            }),
          ],
        }),
      ],
    });

  // Column widths in DXA (twentieths of a point). Total ≈ 8000 for A4 portrait.
  const COL = { sn: 700, matric: 2600, status: 1400, method: 1400, detected: 1900 };

  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      headCell("S/N",          COL.sn),
      headCell("Matric Number", COL.matric),
      headCell("Status",        COL.status),
      headCell("Method",        COL.method),
      headCell("Detected At",   COL.detected),
    ],
  });

  const tableDataRows = m.rows.map(
    (r) =>
      new TableRow({
        children: [
          dataCell(String(r.sn), COL.sn, { align: AlignmentType.CENTER }),
          dataCell(r.matricNumber, COL.matric, { mono: true }),
          dataCell(
            r.status === "present" ? "Present" : "Absent",
            COL.status,
            {
              fill:  r.status === "present" ? GREEN_BG : RED_BG,
              color: r.status === "present" ? GREEN_FG : RED_FG,
              bold: true,
              align: AlignmentType.CENTER,
            }
          ),
          dataCell(
            r.method === "camera" ? "Camera" : r.method === "manual" ? "Manual" : "—",
            COL.method,
            { align: AlignmentType.CENTER }
          ),
          dataCell(
            r.detectedAt ? format(new Date(r.detectedAt), "h:mm a") : "—",
            COL.detected,
            { align: AlignmentType.CENTER }
          ),
        ],
      })
  );

  const attendanceTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [tableHeaderRow, ...tableDataRows],
  });

  // Build meta info lines for the info block
  const timeLabel = [
    m.sessionStart,
    m.sessionEnd ? `– ${m.sessionEnd}` : "",
    m.durationMin ? `(${m.durationMin} min)` : "",
  ]
    .filter(Boolean)
    .join("  ");

  const metaRows: [string, string][] = [
    ["Course Code", m.course.courseCode],
    ["Course Title", m.course.courseName],
    ["Date", m.sessionDate],
    ["Time", timeLabel],
    ...(m.venue ? [["Venue", m.venue] as [string, string]] : []),
    ["Generated", new Date().toLocaleString()],
  ];

  const spacer = new Paragraph({ text: "", spacing: { after: 120 } });

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22, color: "1E293B" } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top:    convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left:   convertInchesToTwip(1),
              right:  convertInchesToTwip(1),
            },
          },
        },
        children: [
          // ── Branding header ──────────────────────────────────────────────
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "CHAKAM", bold: true, size: 40, color: BLUE }),
              new TextRun({ text: "  ·  Attendance Report", size: 26, color: "64748B" }),
            ],
          }),

          // Blue rule under brand
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE } },
            spacing: { after: 280 },
            children: [],
          }),

          // ── Session metadata ─────────────────────────────────────────────
          ...metaRows.map(
            ([label, value]) =>
              new Paragraph({
                spacing: { after: 80 },
                children: [
                  new TextRun({ text: `${label}:`, bold: true, size: 20, color: "475569" }),
                  new TextRun({ text: `  ${value}`, size: 20, color: "1E293B" }),
                ],
              })
          ),

          spacer,

          // ── Section heading ──────────────────────────────────────────────
          new Paragraph({
            spacing: { after: 160 },
            children: [
              new TextRun({
                text: "ATTENDANCE RECORD",
                bold: true,
                size: 22,
                color: BLUE,
                allCaps: true,
              }),
            ],
          }),

          // ── Table ────────────────────────────────────────────────────────
          attendanceTable,

          spacer,

          // ── Summary ──────────────────────────────────────────────────────
          new Paragraph({
            spacing: { after: 160 },
            children: [
              new TextRun({ text: "SUMMARY", bold: true, size: 22, color: BLUE, allCaps: true }),
            ],
          }),

          ...(
            [
              ["Present",         `${m.presentCount} student${m.presentCount !== 1 ? "s" : ""}`,   GREEN_FG],
              ["Absent",          `${m.absentCount} student${m.absentCount !== 1 ? "s" : ""}`,    RED_FG  ],
              ["Total",           `${m.totalCount} student${m.totalCount !== 1 ? "s" : ""}`,      "334155"],
              ["Attendance Rate", m.attendanceRate,                                                 m.presentCount / Math.max(m.totalCount, 1) >= 0.5 ? GREEN_FG : RED_FG],
            ] as [string, string, string][]
          ).map(
            ([label, value, valueColor]) =>
              new Paragraph({
                spacing: { after: 100 },
                children: [
                  new TextRun({ text: `${label}:`, bold: true, size: 20, color: "475569" }),
                  new TextRun({ text: `  ${value}`, size: 20, color: valueColor, bold: true }),
                ],
              })
          ),

          // Footer note
          new Paragraph({
            spacing: { before: 400 },
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: "Generated by Chakam Smart Classroom System",
                size: 16,
                color: "94A3B8",
                italics: true,
              }),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadFile(blob, `${m.filename}.docx`);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

function exportPDF(m: ExportMeta) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW  = doc.internal.pageSize.getWidth();
  const pageH  = doc.internal.pageSize.getHeight();
  const margin = 14;

  // ── Blue header band ──────────────────────────────────────────────────────
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, 30, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("CHAKAM", margin, 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Attendance Report", margin, 21);

  // Report date top-right
  doc.setFontSize(8);
  doc.text(new Date().toLocaleDateString(), pageW - margin, 21, { align: "right" });

  // ── Course title ──────────────────────────────────────────────────────────
  let y = 40;
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`${m.course.courseCode}  –  ${m.course.courseName}`, margin, y);
  y += 7;

  // ── Session metadata ──────────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);

  const timeLabel = [
    m.sessionStart,
    m.sessionEnd ? `– ${m.sessionEnd}` : "",
    m.durationMin ? `(${m.durationMin} min)` : "",
  ]
    .filter(Boolean)
    .join("  ");

  const metaLines: string[] = [
    `Date: ${m.sessionDate}     Time: ${timeLabel}`,
    ...(m.venue ? [`Venue: ${m.venue}`] : []),
  ];

  metaLines.forEach((line) => {
    doc.text(line, margin, y);
    y += 5;
  });

  y += 2;

  // Divider
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // ── Attendance table ──────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [["S/N", "Matric Number", "Status", "Method", "Detected At"]],
    body: m.rows.map((r) => [
      r.sn,
      r.matricNumber,
      r.status === "present" ? "Present" : "Absent",
      r.method === "camera" ? "Camera" : r.method === "manual" ? "Manual" : "—",
      r.detectedAt ? format(new Date(r.detectedAt), "h:mm a") : "—",
    ]),
    styles: {
      fontSize: 8.5,
      cellPadding: 3.5,
      valign: "middle",
    },
    headStyles: {
      fillColor: [30, 64, 175],
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
      fontSize: 8.5,
    },
    bodyStyles: {
      textColor: [30, 41, 59],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 12,  halign: "center" },
      1: { cellWidth: 50,  font: "courier"  },
      2: { cellWidth: 28,  halign: "center" },
      3: { cellWidth: 28,  halign: "center" },
      4: { cellWidth: 36,  halign: "center" },
    },
    // Colour the Status column green/red per row
    didParseCell(data) {
      if (data.section === "body" && data.column.index === 2) {
        const val = String(data.cell.raw);
        if (val === "Present") {
          data.cell.styles.textColor = [22, 163, 74];
          data.cell.styles.fontStyle = "bold";
        } else {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
    margin: { left: margin, right: margin },
  });

  // ── Summary block ─────────────────────────────────────────────────────────
  const tableDoc = doc as jsPDF & { lastAutoTable: { finalY: number } };
  const summaryY = tableDoc.lastAutoTable.finalY + 8;

  doc.setDrawColor(226, 232, 240);
  doc.line(margin, summaryY - 3, pageW - margin, summaryY - 3);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("Summary", margin, summaryY + 2);

  const summaryItems = [
    { label: "Present",         value: String(m.presentCount), color: [22, 163, 74]  as [number,number,number] },
    { label: "Absent",          value: String(m.absentCount),  color: [220, 38, 38]  as [number,number,number] },
    { label: "Total",           value: String(m.totalCount),   color: [30, 41, 59]   as [number,number,number] },
    { label: "Attendance Rate", value: m.attendanceRate,
      color: (m.presentCount / Math.max(m.totalCount, 1) >= 0.5
        ? [22, 163, 74] : [220, 38, 38]) as [number, number, number] },
  ];

  let sx = margin;
  const sy = summaryY + 9;
  summaryItems.forEach(({ label, value, color }) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(label, sx, sy);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...color);
    doc.text(value, sx, sy + 6);

    sx += 44;
  });

  // ── Page footer on every page ─────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.setFont("helvetica", "normal");

    doc.text(
      "Generated by Chakam Smart Classroom System",
      margin,
      pageH - 8
    );
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageW - margin,
      pageH - 8,
      { align: "right" }
    );
  }

  doc.save(`${m.filename}.pdf`);
}
