import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 38,
          background: "#142b23",
        }}
      >
        <div
          style={{
            width: 112,
            height: 112,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "56px 56px 56px 18px",
            background: "#b9ed65",
            color: "#142b23",
            fontSize: 76,
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          A
        </div>
      </div>
    ),
    size,
  );
}
