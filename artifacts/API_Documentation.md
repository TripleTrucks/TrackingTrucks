This document outlines the API endpoints available for retrieving data collections from the local repository database.

---

## Overview

The API consists of read-only HTTP `GET` endpoints that return structured JSON data sourced from specified local directories.

* **Base Path:** `/api`
* **HTTP Method:** `GET`
* **Response Format:** `application/json`

---

## Standard Response Structure

All endpoints return a consistent JSON envelope to standardise client handling.

## Endpoint Reference

### 1. Get Trucks Data

Retrieves dataset contents from the local `Trucks` database directory.

* **Endpoint:** `/api/Trucks.json`
* **Method:** `GET`
* **Response Code:** `200 OK`

### 2. Get Schedules Data

Retrieves dataset contents from the local `Schedules` database directory.

* **Endpoint:** `/api/Schedules.json`
* **Method:** `GET`
* **Response Code:** `200 OK`

### 3. Get Profiles Data

Retrieves dataset contents from the local `Profiles` database directory.

* **Endpoint:** `/api/Profiles.json`
* **Method:** `GET`
* **Response Code:** `200 OK`
