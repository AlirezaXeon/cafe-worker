// مدیریت یکپارچه مسیر و نام فایل تصاویر

export function imageFilename(path) {
  if (!path || typeof path !== "string") return "";
  return path.split("/").pop().trim();
}

export function imagePath(filename) {
  const name = imageFilename(filename);
  return name ? `/images/${name}` : "";
}
