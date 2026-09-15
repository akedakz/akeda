import { ImageResponse } from "next/og";

export function createPwaIcon(size: number, maskable = false) {
  const outerRadius = maskable ? 0 : Math.round(size * 0.23);
  const markSize = Math.round(size * (maskable ? 0.54 : 0.62));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: outerRadius,
          background: "#142b23",
        }}
      >
        <div
          style={{
            width: markSize,
            height: markSize,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: `${Math.round(markSize / 2)}px ${Math.round(markSize / 2)}px ${Math.round(markSize / 2)}px ${Math.round(markSize * 0.14)}px`,
            background: "#b9ed65",
            color: "#142b23",
            fontSize: Math.round(markSize * 0.66),
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          A
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
}
