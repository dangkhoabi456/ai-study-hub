const supabase = require("../config/supabase");

exports.searchUsers = async (req, res) => {
  try {
    const queryText = String(req.query.q || "")
      .trim()
      .replace(/^@+/, "")
      .trim();

    if (queryText.length < 2) {
      return res.status(200).json({
        status: "success",
        data: [],
      });
    }

    const safeQuery = queryText.replaceAll(",", " ");
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, full_name, email, role, status")
      .neq("status", "DISABLED")
      .or(
        `username.ilike.%${safeQuery}%,full_name.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%`,
      )
      .limit(30);

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: data || [],
    });
  } catch (error) {
    console.error("Search users error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not search users.",
      error: error.message,
    });
  }
};

exports.updateProfileBio = async (req, res) => {
  try {
    const bio = String(req.body?.bio || "").trim();
    const wordCount = bio === "" ? 0 : bio.split(/\s+/).length;

    if (!bio) {
      return res.status(400).json({
        status: "error",
        message: "Vui lòng nhập mô tả bản thân.",
      });
    }

    if (wordCount > 350) {
      return res.status(400).json({
        status: "error",
        message: "Mô tả bản thân không được vượt quá 350 chữ.",
      });
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({
        bio,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.user.id)
      .select("id, email, username, full_name, bio, role, status")
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("Update profile bio error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not update profile description.",
      error: error.message,
    });
  }
};
