# Gradewick (Warwick Grade Tracker)

A local-first academic dashboard for tracking grades, calculating degree averages, and predicting module targets at the University of Warwick.

## Architecture & Philosophy
*   **Local Storage:** Data is stored exclusively in the browser's `localStorage`. There is no backend infrastructure, ensuring all academic data remains strictly on the user's device.
*   **Warwick Integration:** Operates on a database of over 3,500 University of Warwick modules. The application automatically populates CATS credits, assessment components, and exact weightings upon entering a valid module code.
*   **Predictive Calculation:** Computes CATS weightings across multiple academic years and calculates the exact marks required in future, ungraded assessments to achieve specific degree classifications.

## Features
*   **Dashboard:** Provides an overview of academic progress, upcoming deadlines, and current degree boundaries.
*   **Course Onboarding:** Automatically loads core module structures based on department and degree selection.
*   **Target Grade Planner:** Simulates future marks to determine the exact requirements for a First, 2:1, or other specific classifications.
*   **Unified Timetable:** Filters upcoming assessments by category or completion status.
*   **Revision Checklist:** Tracks study progress for individual module topics.
*   **Customization:** Includes Dark Mode, compact layout toggles, and adjustable UI accent colors.
*   **Data Portability:** Supports exporting grades as a CSV spreadsheet and full profile backup/restoration via JSON. 

## Usage
Gradewick is a static web application requiring no installation or account creation. It can be run locally by opening `index.html` in any web browser, or accessed directly via the live environment:

**[https://gradewick.com](https://gradewick.com)**

---
*Developed by Kuku Dompreh (@domperzk)*
