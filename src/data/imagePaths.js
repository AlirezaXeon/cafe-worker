// مدیریت یکپارچه مسیر و نام فایل تصاویر

export function imageFilename(path) {
  if (!path || typeof path !== "string") return "";
  return path.split("/").pop().trim();
}
