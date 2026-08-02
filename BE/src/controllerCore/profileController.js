const path = require("path");
const supabase = require("../config/supabase");

const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET || "avatars";
const PROFILE_NAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function mapProfile(profile) {
  return {
    id: profile.id,
    email: profile.email,
    username: profile.username,
    full_name: profile.full_name,
    bio: profile.bio || "",
    last_name_change: profile.last_name_change,
    date_of_birth: profile.date_of_birth,
    is_dob_public: profile.is_dob_public,
    created_at: profile.created_at,
    role: profile.role,
    status: profile.status,
    updated_at: profile.updated_at,
    last_login_at: profile.last_login_at,
    avatar_url: profile.avatar_url || "",
  };
}

exports.getMyProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    if (userId === "guest" || userId === "00000000-0000-0000-0000-000000000000" || req.user.role === "GUEST") {
      return res.status(200).json({
        status: "success",
        data: {
          id: "00000000-0000-0000-0000-000000000000",
          email: "guest@studyhub.local",
          username: "GuestUser",
          full_name: "Guest",
          role: "GUEST",
          status: "ACTIVE",
          avatar_url: "",
          bio: "",
        },
      });
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, email, username, full_name, bio, last_name_change, date_of_birth, is_dob_public, created_at, role, status, updated_at, last_login_at, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;

    if (!profile) {
      return res.status(404).json({
        status: "error",
        message: "Profile not found.",
      });
    }

    return res.status(200).json({
      status: "success",
      data: mapProfile(profile),
    });
  } catch (error) {
    console.error("Failed to load profile:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load profile.",
      error: error.message,
    });
  }
};

exports.updateMyProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    if (userId === "guest" || userId === "00000000-0000-0000-0000-000000000000" || req.user.role === "GUEST") {
      return res.status(403).json({
        status: "error",
        message: "Guest profile cannot be updated.",
      });
    }

    const updates = {};

    if (req.body?.full_name !== undefined) {
      const fullName = String(req.body.full_name || "").trim();
      if (!fullName) {
        return res.status(400).json({
          status: "error",
          message: "Profile name is required.",
        });
      }
      if (fullName.length > 80) {
        return res.status(400).json({
          status: "error",
          message: "Profile name must be 80 characters or fewer.",
        });
      }
      updates.full_name = fullName;
    }

    if (req.body?.bio !== undefined) {
      const bio = String(req.body.bio || "").trim();
      updates.bio = bio;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No profile fields to update.",
      });
    }

    const { data: currentProfile, error: currentProfileError } = await supabase
      .from("profiles")
      .select("id, full_name, last_name_change")
      .eq("id", userId)
      .maybeSingle();

    if (currentProfileError) throw currentProfileError;

    if (!currentProfile) {
      return res.status(404).json({
        status: "error",
        message: "Profile not found.",
      });
    }

    if (updates.full_name && updates.full_name !== currentProfile.full_name) {
      const lastChangedAt = currentProfile.last_name_change
        ? new Date(currentProfile.last_name_change).getTime()
        : 0;
      const remainingMs =
        PROFILE_NAME_COOLDOWN_MS - (Date.now() - lastChangedAt);

      if (lastChangedAt && remainingMs > 0) {
        const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
        return res.status(429).json({
          status: "error",
          message: `You can change your display name again in ${remainingDays} day${
            remainingDays === 1 ? "" : "s"
          }.`,
        });
      }
      updates.last_name_change = new Date().toISOString();
    }

    updates.updated_at = new Date().toISOString();

    const { data: profile, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select("id, email, username, full_name, bio, last_name_change, date_of_birth, is_dob_public, created_at, role, status, updated_at, last_login_at, avatar_url")
      .single();

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: mapProfile(profile),
    });
  } catch (error) {
    console.error("Failed to update profile:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not update profile.",
      error: error.message,
    });
  }
};

exports.updateMyAvatar = async (req, res) => {
  try {
    const userId = req.user.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        status: "error",
        message: "Avatar file is required.",
      });
    }

    // 1. Dọn dẹp avatar cũ trong storage nếu tồn tại
    try {
      const { data: currentProfile } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", userId)
        .maybeSingle();

      if (currentProfile && currentProfile.avatar_url) {
        const oldUrl = currentProfile.avatar_url;
        const marker = `/${AVATAR_BUCKET}/`;
        const markerIndex = oldUrl.indexOf(marker);
        if (markerIndex !== -1) {
          const oldPath = oldUrl.substring(markerIndex + marker.length);
          await supabase.storage.from(AVATAR_BUCKET).remove([oldPath]);
        }
      }
    } catch (delError) {
      console.warn("Failed to cleanup old avatar file:", delError);
    }

    // 2. Tạo đường dẫn file mới có timestamp để tránh browser cache và CDN cache
    const extension = path.extname(file.originalname || "").toLowerCase() || ".png";
    const avatarPath = `${userId}/avatar_${Date.now()}${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(avatarPath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(avatarPath);

    const { data: profile, error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: publicUrlData.publicUrl })
      .eq("id", userId)
      .select("id, email, username, full_name, last_name_change, date_of_birth, is_dob_public, created_at, role, status, updated_at, last_login_at, avatar_url")
      .single();

    if (updateError) throw updateError;

    return res.status(200).json({
      status: "success",
      data: mapProfile(profile),
    });
  } catch (error) {
    console.error("Failed to update avatar:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not update avatar.",
      error: error.message,
    });
  }
};
