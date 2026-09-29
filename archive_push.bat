@echo off
REM Auto-archive + push the dudu mini-program to GitHub (safe manual fallback).
cd /d C:\Users\Administrator\WorkBuddy\2026-09-11-21-15-54\comic_miniapp
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "auto-archive %date% %time%"
  git push origin main
  echo Archived and pushed.
) else (
  echo No changes to archive.
)
