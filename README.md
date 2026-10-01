# MediLink: Smart Emergency Medical Record System

MediLink is a smart emergency medical record system designed to help medical staff quickly access and manage patient information during emergency situations.

The system connects a staff-facing web application, a patient mobile application, and a SQL database through a Node.js/Express backend.

## Features

- Staff authentication and session-based access control
- Patient registration and medical record management
- Fast patient identification using QR codes or patient ID
- Patient vital signs and medical information
- Family-linked clinical risk assessment
- Patient mobile application built with React Native
- Chatbot functionality
- Communication between the web application, backend, database, and mobile application

## System Architecture

MediLink follows a three-tier architecture:

**Presentation Layer**
- Staff web application
- Patient mobile application

**Application Layer**
- Node.js
- Express.js
- Authentication and session management
- Patient and medical-record services
- QR-based patient identification
- Clinical risk assessment logic

**Data Layer**
- SQL database
- Patient information
- Medical records
- Vital signs
- Family relationships and risk information

## Technologies

- JavaScript
- Node.js
- Express.js
- React Native
- Expo
- MySQL / SQLite
- HTML / CSS
- EJS
- Git / GitHub

## Project Structure

```text
medilink/
├── mobile-patient-app/    # React Native patient application
├── public/                # Public web assets
├── scripts/               # Utility and project scripts
├── services/              # Backend services and application logic
├── views/                 # Web application views
├── db.js                  # Database configuration
├── server.js              # Main Express server
├── package.json           # Project dependencies and scripts
├── env.example            # Environment configuration example
└── README.md              # Project documentation
```

## How It Works

A medical staff member first authenticates through the staff web application. After authentication, the system allows authorized staff to locate a patient using their patient ID or QR code.

The backend processes the request and retrieves the relevant information from the SQL database. Patient information can include medical records, vital signs, and family-linked risk information.

The React Native mobile application provides a separate patient-facing interface that communicates with the backend.

## Family-Linked Risk Assessment

One of the main features of MediLink is its ability to associate patients with family members and use related medical information as part of clinical risk assessment.

This allows the system to organize inherited or family-related conditions alongside the patient's individual medical information.

## Testing

The main system workflows were tested across the different components, including:

- Staff authentication
- Patient registration
- Patient identification
- QR-based patient access
- Medical record management
- Vital-sign management
- Family-linked risk assessment
- Chatbot functionality
- Mobile application connectivity

## Project Purpose

MediLink was developed as a senior engineering project to demonstrate the design and implementation of an integrated healthcare software system combining web development, backend services, databases, mobile development, and access control.
