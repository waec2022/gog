/* =========================================================
   CAMPUS GUIDE — data.js
   SAMPLE DATA ONLY. Once the Editor + Worker exist, this file
   is replaced by a generated data file published through that
   pipeline — nothing here is real production content.
   ========================================================= */

var CAMPUS_DATA = {
  /* site-wide live notification banner. null = hidden */
  liveUpdate: {
    id: "live-001",
    title: "Shuttle is currently operating on campus",
    expiresAt: "2026-12-31T23:59:59",
    priority: "urgent"
  },

  records: [
    // ---------------- FACULTIES ----------------
    {
      id: "faculty-computing",
      type: "faculty",
      title: "Faculty of Computing",
      subtitle: "Faculty",
      description: "Houses the Department of Computer Science and related programs.",
      keywords: ["computing", "faculty of computing"],
      verification: "verified-information",
      related: ["dept-cs", "office-bursary"]
    },

    // ---------------- DEPARTMENTS ----------------
    {
      id: "dept-cs",
      type: "department",
      title: "Department of Computer Science",
      subtitle: "Department · Faculty of Computing",
      description: "Offers undergraduate and postgraduate programs in Computer Science.",
      keywords: ["computer science", "cs department", "comp sci"],
      verification: "verified-information",
      faculty: "faculty-computing",
      related: ["faculty-computing", "lect-okoro", "course-csc201", "office-cs-dept"]
    },

    // ---------------- OFFICES ----------------
    {
      id: "office-bursary",
      type: "office",
      title: "Bursary",
      subtitle: "Office",
      description: "Handles all financial matters including school fees, payments, refunds and financial enquiries.",
      keywords: ["bursary", "finance office", "pay school fees", "payment"],
      verification: "verified-information",
      location: "Administration Block, Ground Floor",
      hours: "Mon - Fri · 8:00 AM - 4:00 PM",
      phone: "0812 345 6789",
      email: "bursary@university.edu.ng",
      mapUrl: "https://maps.google.com/?q=University+Administration+Block",
      whatToBring: ["Student ID", "Payment receipt", "Matric number"],
      related: ["service-school-fees-payment"]
    },
    {
      id: "office-cs-dept",
      type: "office",
      title: "Computer Science Department Office",
      subtitle: "Office · Main Building, Room 312",
      description: "Departmental administration office for the Department of Computer Science.",
      keywords: ["cs office", "computer science office"],
      verification: "verified-information",
      location: "Computer Science Department, Main Building, Room 312",
      hours: "Mon - Fri · 9:00 AM - 3:00 PM",
      mapUrl: "https://maps.google.com/?q=Main+Building+Room+312",
      related: ["dept-cs", "lect-okoro"]
    },

    // ---------------- SERVICES ----------------
    {
      id: "service-school-fees-payment",
      type: "service",
      title: "School Fees Payment",
      subtitle: "Service",
      description: "Information about payment procedures and requirements for school fees.",
      keywords: ["school fee", "pay fees", "fees payment"],
      verification: "verified-information",
      related: ["office-bursary", "info-school-fees"]
    },

    // ---------------- BUILDINGS / LOCATIONS ----------------
    {
      id: "building-admin",
      type: "building",
      title: "Administration Block",
      subtitle: "Building",
      description: "Houses the Bursary, Student Affairs, and senior administrative offices.",
      keywords: ["admin block", "administration building"],
      verification: "verified-information",
      mapUrl: "https://maps.google.com/?q=University+Administration+Block",
      related: ["office-bursary"]
    },

    // ---------------- LECTURERS ----------------
    {
      id: "lect-okoro",
      type: "lecturer",
      title: "Dr. John Okoro",
      subtitle: "Lecturer · Department of Computer Science",
      description: "Dr. John Okoro is a lecturer in the Department of Computer Science. He specialises in Software Engineering, Data Structures and Artificial Intelligence.",
      keywords: ["john okoro", "dr okoro", "okoro"],
      verification: "verified-staff",
      photo: "",
      phone: "0812 345 6789",
      email: "jokoro@unical.edu.ng",
      office: "office-cs-dept",
      courses: ["course-csc201", "course-csc301"],
      department: "dept-cs",
      faculty: "faculty-computing",
      related: ["dept-cs", "office-cs-dept", "course-csc201"]
    },

    // ---------------- COURSES ----------------
    {
      id: "course-csc201",
      type: "course",
      title: "CSC 201 — Introduction to Programming",
      subtitle: "Course · 200 Level · First Semester",
      description: "Introductory course covering programming fundamentals using a structured language.",
      keywords: ["csc 201", "csc201", "introduction to programming"],
      verification: "verified-information",
      level: "200",
      semester: "First Semester",
      department: "dept-cs",
      faculty: "faculty-computing",
      lecturers: ["lect-okoro"],
      related: ["dept-cs", "lect-okoro"]
    },
    {
      id: "course-csc301",
      type: "course",
      title: "CSC 301 — Software Engineering",
      subtitle: "Course · 300 Level · First Semester",
      description: "Covers software development lifecycle, design patterns and team-based projects.",
      keywords: ["csc 301", "csc301", "software engineering"],
      verification: "verified-information",
      level: "300",
      semester: "First Semester",
      department: "dept-cs",
      faculty: "faculty-computing",
      lecturers: ["lect-okoro"],
      related: ["dept-cs", "lect-okoro"]
    },

    // ---------------- ADMISSIONS / INFORMATION ----------------
    {
      id: "info-admission-requirements",
      type: "information",
      category: "Admissions",
      title: "Admission Requirements",
      subtitle: "Information · Admissions",
      description: "UTME, O'Level, and Direct Entry requirements for undergraduate admission.",
      keywords: ["admission requirements", "utme", "o level requirements", "direct entry"],
      verification: "verified-information",
      related: ["info-school-fees"]
    },
    {
      id: "info-school-fees",
      type: "information",
      category: "School Fees",
      title: "School Fees Schedule",
      subtitle: "Information · School Fees",
      description: "Current school fees breakdown by faculty and level.",
      keywords: ["school fee", "fees schedule", "tuition"],
      verification: "verified-information",
      downloadAllowed: true,
      documentUrl: "",
      related: ["service-school-fees-payment"]
    },

    // ---------------- ANNOUNCEMENTS / UPDATES / EVENTS / CAMPAIGNS ----------------
    {
      id: "update-registration-deadline",
      type: "update",
      category: "Update",
      title: "Registration deadline extended",
      subtitle: "Oct 3, 2026",
      description: "The course registration deadline has been extended to October 10, 2026.",
      keywords: ["registration deadline"],
      verification: "verified-information",
      publishedAt: "2026-10-03"
    },
    {
      id: "announcement-exam-timetable",
      type: "announcement",
      category: "Announcement",
      title: "Examination timetable released",
      subtitle: "Oct 2, 2026",
      description: "The examination timetable for this semester has been published.",
      keywords: ["exam timetable", "examination timetable"],
      verification: "verified-information",
      publishedAt: "2026-10-02",
      related: ["info-timetable"]
    },
    {
      id: "event-orientation",
      type: "event",
      category: "Event",
      title: "Student orientation programme",
      subtitle: "Oct 12, 2026",
      description: "Orientation programme for newly admitted students.",
      keywords: ["orientation", "student orientation"],
      verification: "verified-information",
      publishedAt: "2026-10-12"
    },
    {
      id: "campaign-health-awareness",
      type: "campaign",
      category: "Campaign",
      title: "Health awareness campaign",
      subtitle: "Oct 5, 2026",
      description: "A campus-wide health awareness and screening campaign.",
      keywords: ["health awareness"],
      verification: "verified-information",
      publishedAt: "2026-10-05"
    },

    // ---------------- TIMETABLE (example entry) ----------------
    {
      id: "info-timetable",
      type: "information",
      category: "Timetable",
      title: "Computer Science Timetable — 300 Level, First Semester",
      subtitle: "Information · Timetable",
      description: "Weekly lecture timetable for 300 Level Computer Science, First Semester.",
      keywords: ["timetable", "cs timetable", "300 level timetable"],
      verification: "verified-information",
      downloadAllowed: true,
      documentUrl: "",
      related: ["dept-cs"]
    }
  ]
};
