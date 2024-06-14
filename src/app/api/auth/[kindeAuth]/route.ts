import { handleAuth } from "@kinde-oss/kinde-auth-nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, { params }: any) {
  const endpoint = params.kindeAuth;

  // Assuming handleAuth needs to be called and returns a Response
  const response = handleAuth(request, endpoint);

  if (response instanceof Response) {
    return response;
  } else {
    return NextResponse.json(
      { error: "Invalid response from handleAuth" },
      { status: 500 }
    );
  }
}
