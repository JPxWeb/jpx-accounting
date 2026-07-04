---
title: SIE-formatet — export och import av redovisningsdata
source: Föreningen SIE-gruppen — SIE-formatets tekniska beskrivning
url: https://sie.se/
effective: 2026-07-04
---

## Vad SIE är

- SIE är ett svenskt standardformat för att utbyta redovisningsdata mellan program, till exempel mellan försystem, bokföringsprogram, bokslutsprogram och revisorer.
- Formatet förvaltas av Föreningen SIE-gruppen.
- Typerna: SIE 1 (årssaldon), SIE 2 (periodsaldon), SIE 3 (objektsaldon) och SIE 4 (transaktioner — kompletta verifikationer).
- SIE 4 finns i två varianter: 4E (export från bokföringsprogram, med saldon och verifikationer) och 4I (import av verifikationer till bokföringsprogram).
- Vanliga filändelser är .se för typ 4E och .si för typ 4I.

## Teknisk uppbyggnad

- En SIE-fil är en textfil där varje rad inleds med en etikett med #-prefix.
- Teckenkodningen enligt standarden är IBM PC 8-bitars teckentabell (Code page 437) — etiketten #FORMAT anger värdet PC8.
- Obligatoriska identifikationsposter: #FLAGGA, #PROGRAM, #FORMAT, #GEN (genereringsdatum), #SIETYP och #FNAMN (företagsnamn).
- Vanliga metadataposter: #ORGNR (organisationsnummer), #RAR (räkenskapsår), #KONTO (kontonummer och kontonamn), #SRU (SRU-kod per konto), #IB och #UB (ingående och utgående balans per konto) samt #RES (resultat per konto).
- Datum skrivs i formatet ÅÅÅÅMMDD.

## Verifikationer i SIE 4

- En verifikation inleds med posten #VER med fälten serie, verifikationsnummer, verifikationsdatum och verifikationstext.
- Verifikationens transaktionsrader anges med #TRANS inom klamrar { } och innehåller kontonummer, objektlista, belopp samt valfritt transaktionsdatum, transaktionstext och kvantitet.
- Debet anges som positivt belopp och kredit som negativt belopp.
- Transaktionsraderna i en verifikation ska summera till noll — filen bär själv sin balanskontroll.
- Posterna #RTRANS och #BTRANS kan förekomma för att beskriva rättade respektive borttagna transaktionsrader.

## Användning i praktiken

- SIE 4I används för att föra in verifikationer från försystem (till exempel fakturering eller lönesystem) i bokföringen.
- SIE 4E används för att lämna hela bokföringen vidare, till exempel till revisor, bokslutsprogram eller vid byte av bokföringsprogram.
- Kontoplanen i filen (posterna #KONTO) följer i praktiken BAS-kontoplanens fyrsiffriga kontonummer.
